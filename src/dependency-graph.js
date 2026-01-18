/**
 * Dependency Graph with Inverted Index
 *
 * Provides O(1) lookup for both dependencies and dependents,
 * replacing the O(n) regex-based scanning in the original implementation.
 */

/**
 * Dependency graph with bidirectional indexing
 */
export class DependencyGraph {
  constructor() {
    // Forward map: noteId -> Set<noteId it depends on>
    this.dependencies = new Map();

    // Inverse map: noteId -> Set<noteId that depend on it>
    this.dependents = new Map();

    // Track baseNote references separately
    this.baseNoteDependents = new Set();

    // StartTime-specific dependency tracking (for drag preview)
    // Forward map: noteId -> Set<noteId its startTime depends on>
    this.startTimeDependencies = new Map();
    // Inverse map: noteId -> Set<noteId whose startTime depends on it>
    this.startTimeDependents = new Map();
    // Track notes whose startTime references baseNote
    this.startTimeBaseNoteDependents = new Set();

    // Property-specific startTime dependency tracking (for resize vs move)
    // Inverse map: noteId -> Set<noteId whose startTime depends on this note's startTime>
    this.startTimeOnStartTimeDependents = new Map();
    // Inverse map: noteId -> Set<noteId whose startTime depends on this note's duration>
    this.startTimeOnDurationDependents = new Map();
    // Inverse map: noteId -> Set<noteId whose startTime depends on this note's frequency>
    this.startTimeOnFrequencyDependents = new Map();

    // Frequency-specific dependency tracking (for property-colored visualization)
    // Forward map: noteId -> Set<noteId its frequency depends on>
    this.frequencyDependencies = new Map();
    // Inverse map: noteId -> Set<noteId whose frequency depends on it>
    this.frequencyDependents = new Map();
    // Track notes whose frequency references baseNote
    this.frequencyBaseNoteDependents = new Set();
    // Property-specific: which property of dependency is referenced by this note's frequency
    this.frequencyOnStartTimeDependents = new Map();
    this.frequencyOnDurationDependents = new Map();
    this.frequencyOnFrequencyDependents = new Map();

    // Duration-specific dependency tracking (for property-colored visualization)
    // Forward map: noteId -> Set<noteId its duration depends on>
    this.durationDependencies = new Map();
    // Inverse map: noteId -> Set<noteId whose duration depends on it>
    this.durationDependents = new Map();
    // Track notes whose duration references baseNote
    this.durationBaseNoteDependents = new Set();
    // Property-specific: which property of dependency is referenced by this note's duration
    this.durationOnStartTimeDependents = new Map();
    this.durationOnDurationDependents = new Map();
    this.durationOnFrequencyDependents = new Map();

    // Corruption tracking for irrational number support (TET scales)
    // Maps noteId -> u8 bitmask indicating which properties are corrupted (contain irrational values)
    // Bit flags: 0x01=startTime, 0x02=duration, 0x04=frequency, 0x08=tempo, 0x10=beatsPerMeasure, 0x20=measureLength
    this.corruptionFlags = new Map();
  }

  /**
   * Register dependencies for a note from its binary expression
   *
   * @param {number} noteId - The note being registered
   * @param {BinaryExpression} expr - The expression to extract dependencies from
   */
  registerExpression(noteId, expr) {
    const newDeps = expr.getDependencySet();
    this._updateDependencies(noteId, newDeps, expr.referencesBase);
  }

  /**
   * Register all dependencies for a note (from all its expressions)
   *
   * @param {number} noteId - The note being registered
   * @param {BinaryNote} note - The binary note
   */
  registerNote(noteId, note) {
    const allDeps = note.getAllDependencies();
    const refsBase = note.referencesBaseNote();
    this._updateDependencies(noteId, allDeps, refsBase);
  }

  /**
   * Register startTime-specific dependencies for a note
   * Used for drag preview to only move notes whose startTime depends on dragged note
   *
   * @param {number} noteId - The note being registered
   * @param {BinaryExpression} startTimeExpr - The startTime expression
   */
  registerStartTimeDependencies(noteId, startTimeExpr) {
    const newDeps = startTimeExpr ? startTimeExpr.getDependencySet() : new Set();
    const referencesBase = startTimeExpr ? startTimeExpr.referencesBase : false;

    // CRITICAL: Capture old deps BEFORE updating the forward index
    // This is needed for _updateStartTimePropertyDependencies to properly clean up stale inverse entries
    const oldDeps = this.startTimeDependencies.get(noteId) || new Set();

    this._updateStartTimeDependencies(noteId, newDeps, referencesBase);

    // Also update property-specific tracking, passing old deps for proper cleanup
    const propDeps = startTimeExpr ? startTimeExpr.getPropertyDependencies() : new Map();
    this._updateStartTimePropertyDependencies(noteId, propDeps, oldDeps);
  }

  /**
   * Internal: Update property-specific startTime dependency tracking
   * Tracks which notes' startTime depends on another note's startTime vs duration
   * @param {number} noteId - The note being updated
   * @param {Map} newPropDeps - New property dependencies from the expression
   * @param {Set} oldDeps - The OLD forward deps (captured before _updateStartTimeDependencies)
   */
  _updateStartTimePropertyDependencies(noteId, newPropDeps, oldDeps) {
    // VAR indices: 0 = startTime, 1 = duration, 2 = frequency, 5 = measureLength
    // measureLength is derived from duration, so treat it as duration-related
    const VAR_START_TIME = 0;
    const VAR_DURATION = 1;
    const VAR_FREQUENCY = 2;
    const VAR_MEASURE_LENGTH = 5;

    // Helper to update a specific property inverse map
    // varIndices is an array of VAR indices that should map to this property
    const updatePropertyMap = (propMap, depNoteId, varIndices, newPropDeps) => {
      const newNoteProps = newPropDeps.get(depNoteId);
      const shouldHave = newNoteProps && varIndices.some(idx => newNoteProps.has(idx));

      let depSet = propMap.get(depNoteId);
      const currentlyHas = depSet && depSet.has(noteId);

      if (shouldHave && !currentlyHas) {
        if (!depSet) {
          depSet = new Set();
          propMap.set(depNoteId, depSet);
        }
        depSet.add(noteId);
      } else if (!shouldHave && currentlyHas) {
        depSet.delete(noteId);
        if (depSet.size === 0) {
          propMap.delete(depNoteId);
        }
      }
    };

    // Get all notes that could be affected (union of OLD and NEW deps)
    // CRITICAL: We must use oldDeps passed in, NOT this.startTimeDependencies.get(noteId)
    // because the forward index has already been updated to the new deps
    const allDepNotes = new Set([
      ...oldDeps,
      ...newPropDeps.keys()
    ]);

    for (const depNoteId of allDepNotes) {
      updatePropertyMap(this.startTimeOnStartTimeDependents, depNoteId, [VAR_START_TIME], newPropDeps);
      // measureLength (5) is derived from duration, so include it with duration
      updatePropertyMap(this.startTimeOnDurationDependents, depNoteId, [VAR_DURATION, VAR_MEASURE_LENGTH], newPropDeps);
      updatePropertyMap(this.startTimeOnFrequencyDependents, depNoteId, [VAR_FREQUENCY], newPropDeps);
    }
  }

  /**
   * Internal: Update startTime-specific dependency tracking for a note
   */
  _updateStartTimeDependencies(noteId, newDeps, referencesBase) {
    // Get old dependencies
    const oldDeps = this.startTimeDependencies.get(noteId) || new Set();

    // Remove from inverse index for deps that are no longer referenced
    for (const oldDep of oldDeps) {
      if (!newDeps.has(oldDep)) {
        const depSet = this.startTimeDependents.get(oldDep);
        if (depSet) {
          depSet.delete(noteId);
          if (depSet.size === 0) {
            this.startTimeDependents.delete(oldDep);
          }
        }
      }
    }

    // Add to inverse index for new deps
    for (const newDep of newDeps) {
      if (!oldDeps.has(newDep)) {
        if (!this.startTimeDependents.has(newDep)) {
          this.startTimeDependents.set(newDep, new Set());
        }
        this.startTimeDependents.get(newDep).add(noteId);
      }
    }

    // Update forward index
    this.startTimeDependencies.set(noteId, newDeps);

    // Track baseNote references
    if (referencesBase) {
      this.startTimeBaseNoteDependents.add(noteId);
    } else {
      this.startTimeBaseNoteDependents.delete(noteId);
    }
  }

  /**
   * Register frequency-specific dependencies for a note
   * Used for property-colored visualization
   *
   * @param {number} noteId - The note being registered
   * @param {BinaryExpression} freqExpr - The frequency expression
   */
  registerFrequencyDependencies(noteId, freqExpr) {
    const newDeps = freqExpr ? freqExpr.getDependencySet() : new Set();
    const referencesBase = freqExpr ? freqExpr.referencesBase : false;

    // CRITICAL: Capture old deps BEFORE updating the forward index
    // This is needed for _updateFrequencyPropertyDependencies to properly clean up stale inverse entries
    const oldDeps = this.frequencyDependencies.get(noteId) || new Set();

    this._updateFrequencyDependencies(noteId, newDeps, referencesBase);

    // Also update property-specific tracking, passing old deps for proper cleanup
    const propDeps = freqExpr ? freqExpr.getPropertyDependencies() : new Map();
    this._updateFrequencyPropertyDependencies(noteId, propDeps, oldDeps);
  }

  /**
   * Internal: Update frequency-specific dependency tracking for a note
   */
  _updateFrequencyDependencies(noteId, newDeps, referencesBase) {
    const oldDeps = this.frequencyDependencies.get(noteId) || new Set();

    // Remove from inverse index for deps that are no longer referenced
    for (const oldDep of oldDeps) {
      if (!newDeps.has(oldDep)) {
        const depSet = this.frequencyDependents.get(oldDep);
        if (depSet) {
          depSet.delete(noteId);
          if (depSet.size === 0) {
            this.frequencyDependents.delete(oldDep);
          }
        }
      }
    }

    // Add to inverse index for new deps
    for (const newDep of newDeps) {
      if (!oldDeps.has(newDep)) {
        if (!this.frequencyDependents.has(newDep)) {
          this.frequencyDependents.set(newDep, new Set());
        }
        this.frequencyDependents.get(newDep).add(noteId);
      }
    }

    // Update forward index
    this.frequencyDependencies.set(noteId, newDeps);

    // Track baseNote references
    if (referencesBase) {
      this.frequencyBaseNoteDependents.add(noteId);
    } else {
      this.frequencyBaseNoteDependents.delete(noteId);
    }
  }

  /**
   * Internal: Update property-specific frequency dependency tracking
   * Tracks which notes' frequency depends on another note's startTime/duration/frequency
   * @param {number} noteId - The note being updated
   * @param {Map} newPropDeps - New property dependencies from the expression
   * @param {Set} oldDeps - The OLD forward deps (captured before _updateFrequencyDependencies)
   */
  _updateFrequencyPropertyDependencies(noteId, newPropDeps, oldDeps) {
    // VAR indices: 0 = startTime, 1 = duration, 2 = frequency, 5 = measureLength
    // measureLength is derived from duration, so treat it as duration-related
    const VAR_START_TIME = 0;
    const VAR_DURATION = 1;
    const VAR_FREQUENCY = 2;
    const VAR_MEASURE_LENGTH = 5;

    const updatePropertyMap = (propMap, depNoteId, varIndices, newPropDeps) => {
      const newNoteProps = newPropDeps.get(depNoteId);
      const shouldHave = newNoteProps && varIndices.some(idx => newNoteProps.has(idx));

      let depSet = propMap.get(depNoteId);
      const currentlyHas = depSet && depSet.has(noteId);

      if (shouldHave && !currentlyHas) {
        if (!depSet) {
          depSet = new Set();
          propMap.set(depNoteId, depSet);
        }
        depSet.add(noteId);
      } else if (!shouldHave && currentlyHas) {
        depSet.delete(noteId);
        if (depSet.size === 0) {
          propMap.delete(depNoteId);
        }
      }
    };

    // Get all notes that could be affected (union of OLD and NEW deps)
    // CRITICAL: We must use oldDeps passed in, NOT this.frequencyDependencies.get(noteId)
    // because the forward index has already been updated to the new deps
    const allDepNotes = new Set([
      ...oldDeps,
      ...newPropDeps.keys()
    ]);

    for (const depNoteId of allDepNotes) {
      updatePropertyMap(this.frequencyOnStartTimeDependents, depNoteId, [VAR_START_TIME], newPropDeps);
      // measureLength (5) is derived from duration, so include it with duration
      updatePropertyMap(this.frequencyOnDurationDependents, depNoteId, [VAR_DURATION, VAR_MEASURE_LENGTH], newPropDeps);
      updatePropertyMap(this.frequencyOnFrequencyDependents, depNoteId, [VAR_FREQUENCY], newPropDeps);
    }
  }

  /**
   * Register duration-specific dependencies for a note
   * Used for property-colored visualization
   *
   * @param {number} noteId - The note being registered
   * @param {BinaryExpression} durExpr - The duration expression
   */
  registerDurationDependencies(noteId, durExpr) {
    const newDeps = durExpr ? durExpr.getDependencySet() : new Set();
    const referencesBase = durExpr ? durExpr.referencesBase : false;

    // CRITICAL: Capture old deps BEFORE updating the forward index
    // This is needed for _updateDurationPropertyDependencies to properly clean up stale inverse entries
    const oldDeps = this.durationDependencies.get(noteId) || new Set();

    this._updateDurationDependencies(noteId, newDeps, referencesBase);

    // Also update property-specific tracking, passing old deps for proper cleanup
    const propDeps = durExpr ? durExpr.getPropertyDependencies() : new Map();
    this._updateDurationPropertyDependencies(noteId, propDeps, oldDeps);
  }

  /**
   * Internal: Update duration-specific dependency tracking for a note
   */
  _updateDurationDependencies(noteId, newDeps, referencesBase) {
    const oldDeps = this.durationDependencies.get(noteId) || new Set();

    // Remove from inverse index for deps that are no longer referenced
    for (const oldDep of oldDeps) {
      if (!newDeps.has(oldDep)) {
        const depSet = this.durationDependents.get(oldDep);
        if (depSet) {
          depSet.delete(noteId);
          if (depSet.size === 0) {
            this.durationDependents.delete(oldDep);
          }
        }
      }
    }

    // Add to inverse index for new deps
    for (const newDep of newDeps) {
      if (!oldDeps.has(newDep)) {
        if (!this.durationDependents.has(newDep)) {
          this.durationDependents.set(newDep, new Set());
        }
        this.durationDependents.get(newDep).add(noteId);
      }
    }

    // Update forward index
    this.durationDependencies.set(noteId, newDeps);

    // Track baseNote references
    if (referencesBase) {
      this.durationBaseNoteDependents.add(noteId);
    } else {
      this.durationBaseNoteDependents.delete(noteId);
    }
  }

  /**
   * Internal: Update property-specific duration dependency tracking
   * Tracks which notes' duration depends on another note's startTime/duration/frequency
   * @param {number} noteId - The note being updated
   * @param {Map} newPropDeps - New property dependencies from the expression
   * @param {Set} oldDeps - The OLD forward deps (captured before _updateDurationDependencies)
   */
  _updateDurationPropertyDependencies(noteId, newPropDeps, oldDeps) {
    // VAR indices: 0 = startTime, 1 = duration, 2 = frequency, 5 = measureLength
    // measureLength is derived from duration, so treat it as duration-related
    const VAR_START_TIME = 0;
    const VAR_DURATION = 1;
    const VAR_FREQUENCY = 2;
    const VAR_MEASURE_LENGTH = 5;

    const updatePropertyMap = (propMap, depNoteId, varIndices, newPropDeps) => {
      const newNoteProps = newPropDeps.get(depNoteId);
      const shouldHave = newNoteProps && varIndices.some(idx => newNoteProps.has(idx));

      let depSet = propMap.get(depNoteId);
      const currentlyHas = depSet && depSet.has(noteId);

      if (shouldHave && !currentlyHas) {
        if (!depSet) {
          depSet = new Set();
          propMap.set(depNoteId, depSet);
        }
        depSet.add(noteId);
      } else if (!shouldHave && currentlyHas) {
        depSet.delete(noteId);
        if (depSet.size === 0) {
          propMap.delete(depNoteId);
        }
      }
    };

    // Get all notes that could be affected (union of OLD and NEW deps)
    // CRITICAL: We must use oldDeps passed in, NOT this.durationDependencies.get(noteId)
    // because the forward index has already been updated to the new deps
    const allDepNotes = new Set([
      ...oldDeps,
      ...newPropDeps.keys()
    ]);

    for (const depNoteId of allDepNotes) {
      updatePropertyMap(this.durationOnStartTimeDependents, depNoteId, [VAR_START_TIME], newPropDeps);
      // measureLength (5) is derived from duration, so include it with duration
      updatePropertyMap(this.durationOnDurationDependents, depNoteId, [VAR_DURATION, VAR_MEASURE_LENGTH], newPropDeps);
      updatePropertyMap(this.durationOnFrequencyDependents, depNoteId, [VAR_FREQUENCY], newPropDeps);
    }
  }

  /**
   * Internal: Update dependency tracking for a note
   */
  _updateDependencies(noteId, newDeps, referencesBase) {
    // Get old dependencies
    const oldDeps = this.dependencies.get(noteId) || new Set();

    // Remove from inverse index for deps that are no longer referenced
    for (const oldDep of oldDeps) {
      if (!newDeps.has(oldDep)) {
        const depSet = this.dependents.get(oldDep);
        if (depSet) {
          depSet.delete(noteId);
          if (depSet.size === 0) {
            this.dependents.delete(oldDep);
          }
        }
      }
    }

    // Add to inverse index for new deps
    for (const newDep of newDeps) {
      if (!oldDeps.has(newDep)) {
        if (!this.dependents.has(newDep)) {
          this.dependents.set(newDep, new Set());
        }
        this.dependents.get(newDep).add(noteId);
      }
    }

    // Update forward index
    this.dependencies.set(noteId, newDeps);

    // Track baseNote references
    if (referencesBase) {
      this.baseNoteDependents.add(noteId);
    } else {
      this.baseNoteDependents.delete(noteId);
    }
  }

  /**
   * Remove a note from the graph
   *
   * @param {number} noteId - The note to remove
   */
  removeNote(noteId) {
    // Get and clear forward dependencies
    const deps = this.dependencies.get(noteId);
    if (deps) {
      for (const dep of deps) {
        const depSet = this.dependents.get(dep);
        if (depSet) {
          depSet.delete(noteId);
          if (depSet.size === 0) {
            this.dependents.delete(dep);
          }
        }
      }
      this.dependencies.delete(noteId);
    }

    // Clear inverse dependencies (notes that depend on this one)
    const dependentsOfThis = this.dependents.get(noteId);
    if (dependentsOfThis) {
      for (const dep of dependentsOfThis) {
        const depDeps = this.dependencies.get(dep);
        if (depDeps) {
          depDeps.delete(noteId);
        }
      }
      this.dependents.delete(noteId);
    }

    // Remove from baseNote tracking
    this.baseNoteDependents.delete(noteId);

    // Also remove from startTime-specific tracking
    const startTimeDeps = this.startTimeDependencies.get(noteId);
    if (startTimeDeps) {
      for (const dep of startTimeDeps) {
        const depSet = this.startTimeDependents.get(dep);
        if (depSet) {
          depSet.delete(noteId);
          if (depSet.size === 0) {
            this.startTimeDependents.delete(dep);
          }
        }
      }
      this.startTimeDependencies.delete(noteId);
    }

    const startTimeDependentsOfThis = this.startTimeDependents.get(noteId);
    if (startTimeDependentsOfThis) {
      for (const dep of startTimeDependentsOfThis) {
        const depDeps = this.startTimeDependencies.get(dep);
        if (depDeps) {
          depDeps.delete(noteId);
        }
      }
      this.startTimeDependents.delete(noteId);
    }

    this.startTimeBaseNoteDependents.delete(noteId);

    // Also remove from property-specific tracking
    this.startTimeOnStartTimeDependents.delete(noteId);
    this.startTimeOnDurationDependents.delete(noteId);
    this.startTimeOnFrequencyDependents.delete(noteId);

    // Remove this note from other notes' property-specific dependent sets
    for (const [, depSet] of this.startTimeOnStartTimeDependents) {
      depSet.delete(noteId);
    }
    for (const [, depSet] of this.startTimeOnDurationDependents) {
      depSet.delete(noteId);
    }
    for (const [, depSet] of this.startTimeOnFrequencyDependents) {
      depSet.delete(noteId);
    }

    // Remove from frequency-specific tracking
    const freqDeps = this.frequencyDependencies.get(noteId);
    if (freqDeps) {
      for (const dep of freqDeps) {
        const depSet = this.frequencyDependents.get(dep);
        if (depSet) {
          depSet.delete(noteId);
          if (depSet.size === 0) {
            this.frequencyDependents.delete(dep);
          }
        }
      }
      this.frequencyDependencies.delete(noteId);
    }

    const freqDependentsOfThis = this.frequencyDependents.get(noteId);
    if (freqDependentsOfThis) {
      for (const dep of freqDependentsOfThis) {
        const depDeps = this.frequencyDependencies.get(dep);
        if (depDeps) {
          depDeps.delete(noteId);
        }
      }
      this.frequencyDependents.delete(noteId);
    }

    this.frequencyBaseNoteDependents.delete(noteId);

    // Remove from frequency property-specific tracking
    this.frequencyOnStartTimeDependents.delete(noteId);
    this.frequencyOnDurationDependents.delete(noteId);
    this.frequencyOnFrequencyDependents.delete(noteId);
    for (const [, depSet] of this.frequencyOnStartTimeDependents) {
      depSet.delete(noteId);
    }
    for (const [, depSet] of this.frequencyOnDurationDependents) {
      depSet.delete(noteId);
    }
    for (const [, depSet] of this.frequencyOnFrequencyDependents) {
      depSet.delete(noteId);
    }

    // Remove from duration-specific tracking
    const durDeps = this.durationDependencies.get(noteId);
    if (durDeps) {
      for (const dep of durDeps) {
        const depSet = this.durationDependents.get(dep);
        if (depSet) {
          depSet.delete(noteId);
          if (depSet.size === 0) {
            this.durationDependents.delete(dep);
          }
        }
      }
      this.durationDependencies.delete(noteId);
    }

    const durDependentsOfThis = this.durationDependents.get(noteId);
    if (durDependentsOfThis) {
      for (const dep of durDependentsOfThis) {
        const depDeps = this.durationDependencies.get(dep);
        if (depDeps) {
          depDeps.delete(noteId);
        }
      }
      this.durationDependents.delete(noteId);
    }

    this.durationBaseNoteDependents.delete(noteId);

    // Remove from duration property-specific tracking
    this.durationOnStartTimeDependents.delete(noteId);
    this.durationOnDurationDependents.delete(noteId);
    this.durationOnFrequencyDependents.delete(noteId);
    for (const [, depSet] of this.durationOnStartTimeDependents) {
      depSet.delete(noteId);
    }
    for (const [, depSet] of this.durationOnDurationDependents) {
      depSet.delete(noteId);
    }
    for (const [, depSet] of this.durationOnFrequencyDependents) {
      depSet.delete(noteId);
    }

    // Remove from corruption tracking
    this.corruptionFlags.delete(noteId);
  }

  /**
   * Get direct dependencies for a note (what it depends on)
   * O(1) lookup
   *
   * @param {number} noteId
   * @returns {Set<number>}
   */
  getDependencies(noteId) {
    return this.dependencies.get(noteId) || new Set();
  }

  /**
   * Get direct dependents of a note (what depends on it)
   * O(1) lookup
   *
   * @param {number} noteId
   * @returns {Set<number>}
   */
  getDependents(noteId) {
    return this.dependents.get(noteId) || new Set();
  }

  /**
   * Get all transitive dependents (notes affected when this note changes)
   * Uses BFS to traverse dependency graph
   *
   * @param {number} noteId
   * @returns {Set<number>}
   */
  getAllDependents(noteId) {
    const result = new Set();
    const queue = [noteId];
    let queueIdx = 0; // Use index instead of shift() for O(1)
    const visited = new Set([noteId]);

    while (queueIdx < queue.length) {
      const current = queue[queueIdx++];
      const directDeps = this.dependents.get(current);

      if (directDeps) {
        for (const dep of directDeps) {
          if (!visited.has(dep)) {
            visited.add(dep);
            result.add(dep);
            queue.push(dep);
          }
        }
      }
    }

    return result;
  }

  /**
   * Get direct startTime dependents of a note (notes whose startTime depends on it)
   * O(1) lookup
   *
   * @param {number} noteId
   * @returns {Set<number>}
   */
  getStartTimeDependents(noteId) {
    return this.startTimeDependents.get(noteId) || new Set();
  }

  /**
   * Get all transitive startTime dependents (notes whose startTime is affected when this note moves)
   * Uses BFS to traverse startTime-specific dependency graph
   * This is used for drag preview to only move notes whose position actually depends on the dragged note
   *
   * @param {number} noteId
   * @returns {Set<number>}
   */
  getAllStartTimeDependents(noteId) {
    const result = new Set();
    const queue = [noteId];
    let queueIdx = 0; // Use index instead of shift() for O(1)
    const visited = new Set([noteId]);

    while (queueIdx < queue.length) {
      const current = queue[queueIdx++];
      const directDeps = this.startTimeDependents.get(current);

      if (directDeps) {
        for (const dep of directDeps) {
          if (!visited.has(dep)) {
            visited.add(dep);
            result.add(dep);
            queue.push(dep);
          }
        }
      }
    }

    return result;
  }

  /**
   * Get all notes whose startTime depends on baseNote
   *
   * @returns {Set<number>}
   */
  getStartTimeBaseNoteDependents() {
    return new Set(this.startTimeBaseNoteDependents);
  }

  /**
   * Get direct dependents whose startTime references this note's startTime property
   * O(1) lookup
   *
   * @param {number} noteId
   * @returns {Set<number>}
   */
  getStartTimeOnStartTimeDependents(noteId) {
    return this.startTimeOnStartTimeDependents.get(noteId) || new Set();
  }

  /**
   * Get direct dependents whose startTime references this note's duration property
   * O(1) lookup
   *
   * @param {number} noteId
   * @returns {Set<number>}
   */
  getStartTimeOnDurationDependents(noteId) {
    return this.startTimeOnDurationDependents.get(noteId) || new Set();
  }

  /**
   * Get all transitive dependents whose startTime is affected when this note's startTime changes
   * Used for MOVE preview - only notes whose startTime depends on dragged note's startTime should move
   *
   * @param {number} noteId
   * @returns {Set<number>}
   */
  getAllStartTimeOnStartTimeDependents(noteId) {
    const result = new Set();
    const queue = [noteId];
    let queueIdx = 0;
    const visited = new Set([noteId]);

    while (queueIdx < queue.length) {
      const current = queue[queueIdx++];
      const directDeps = this.startTimeOnStartTimeDependents.get(current);

      if (directDeps) {
        for (const dep of directDeps) {
          if (!visited.has(dep)) {
            visited.add(dep);
            result.add(dep);
            queue.push(dep);
          }
        }
      }
    }

    return result;
  }

  /**
   * Get all transitive dependents whose startTime is affected when this note's duration changes
   * Used for RESIZE preview - only notes whose startTime depends on dragged note's duration should move
   *
   * @param {number} noteId
   * @returns {Set<number>}
   */
  getAllStartTimeOnDurationDependents(noteId) {
    const result = new Set();
    const queue = [noteId];
    let queueIdx = 0;
    const visited = new Set([noteId]);

    while (queueIdx < queue.length) {
      const current = queue[queueIdx++];
      // Get notes whose startTime references current note's duration
      const durationDeps = this.startTimeOnDurationDependents.get(current);

      if (durationDeps) {
        for (const dep of durationDeps) {
          if (!visited.has(dep)) {
            visited.add(dep);
            result.add(dep);
            // Continue traversing - the dependent's startTime now changes,
            // so we need to find notes that depend on the dependent's startTime
            queue.push(dep);
          }
        }
      }

      // Also traverse through notes whose startTime depends on current's startTime
      // (since if current's startTime changes, their startTime changes too)
      if (current !== noteId) {
        const startTimeDeps = this.startTimeOnStartTimeDependents.get(current);
        if (startTimeDeps) {
          for (const dep of startTimeDeps) {
            if (!visited.has(dep)) {
              visited.add(dep);
              result.add(dep);
              queue.push(dep);
            }
          }
        }
      }
    }

    return result;
  }

  /**
   * Get direct dependents whose startTime references this note's frequency property
   * O(1) lookup
   *
   * @param {number} noteId
   * @returns {Set<number>}
   */
  getStartTimeOnFrequencyDependents(noteId) {
    return this.startTimeOnFrequencyDependents.get(noteId) || new Set();
  }

  /**
   * Get all transitive dependents whose startTime is affected when this note's frequency changes
   * Used for property-colored visualization - orange color
   *
   * @param {number} noteId
   * @returns {Set<number>}
   */
  getAllStartTimeOnFrequencyDependents(noteId) {
    const result = new Set();
    const queue = [noteId];
    let queueIdx = 0;
    const visited = new Set([noteId]);

    while (queueIdx < queue.length) {
      const current = queue[queueIdx++];
      // Get notes whose startTime references current note's frequency
      const frequencyDeps = this.startTimeOnFrequencyDependents.get(current);

      if (frequencyDeps) {
        for (const dep of frequencyDeps) {
          if (!visited.has(dep)) {
            visited.add(dep);
            result.add(dep);
            // Continue traversing - the dependent's startTime now changes,
            // so we need to find notes that depend on the dependent's startTime
            queue.push(dep);
          }
        }
      }

      // Also traverse through notes whose startTime depends on current's startTime
      // (since if current's startTime changes, their startTime changes too)
      if (current !== noteId) {
        const startTimeDeps = this.startTimeOnStartTimeDependents.get(current);
        if (startTimeDeps) {
          for (const dep of startTimeDeps) {
            if (!visited.has(dep)) {
              visited.add(dep);
              result.add(dep);
              queue.push(dep);
            }
          }
        }
      }
    }

    return result;
  }

  /**
   * Get all notes transitively affected when this note's FREQUENCY changes.
   * This includes:
   * - Notes whose startTime references this note's frequency (they move)
   * - Notes whose frequency references this note's frequency (their pitch changes)
   * - Notes whose duration references this note's frequency (their duration changes)
   * - And transitively: notes affected by those notes' changed properties
   *
   * @param {number} noteId
   * @returns {Set<number>}
   */
  getAllAffectedByFrequencyChange(noteId) {
    const result = new Set();
    const queue = [{ id: noteId, changedProp: 'frequency' }];
    let queueIdx = 0;
    const visited = new Map(); // id -> Set of properties that have been processed

    while (queueIdx < queue.length) {
      const { id: current, changedProp } = queue[queueIdx++];

      // Track which properties we've processed for this note
      if (!visited.has(current)) {
        visited.set(current, new Set());
      }
      if (visited.get(current).has(changedProp)) {
        continue;
      }
      visited.get(current).add(changedProp);

      if (changedProp === 'frequency') {
        // Notes whose startTime depends on current's frequency -> they MOVE (startTime changes)
        const stOnFreq = this.startTimeOnFrequencyDependents.get(current);
        if (stOnFreq) {
          for (const dep of stOnFreq) {
            if (dep !== noteId) {
              result.add(dep);
              queue.push({ id: dep, changedProp: 'startTime' });
            }
          }
        }

        // Notes whose frequency depends on current's frequency -> their FREQUENCY changes
        const freqOnFreq = this.frequencyOnFrequencyDependents.get(current);
        if (freqOnFreq) {
          for (const dep of freqOnFreq) {
            if (dep !== noteId) {
              result.add(dep);
              queue.push({ id: dep, changedProp: 'frequency' });
            }
          }
        }

        // Notes whose duration depends on current's frequency -> their DURATION changes
        const durOnFreq = this.durationOnFrequencyDependents.get(current);
        if (durOnFreq) {
          for (const dep of durOnFreq) {
            if (dep !== noteId) {
              result.add(dep);
              queue.push({ id: dep, changedProp: 'duration' });
            }
          }
        }
      } else if (changedProp === 'startTime') {
        // Notes whose startTime depends on current's startTime -> they MOVE
        const stOnSt = this.startTimeOnStartTimeDependents.get(current);
        if (stOnSt) {
          for (const dep of stOnSt) {
            if (dep !== noteId) {
              result.add(dep);
              queue.push({ id: dep, changedProp: 'startTime' });
            }
          }
        }

        // Notes whose frequency depends on current's startTime -> their FREQUENCY changes
        const freqOnSt = this.frequencyOnStartTimeDependents.get(current);
        if (freqOnSt) {
          for (const dep of freqOnSt) {
            if (dep !== noteId) {
              result.add(dep);
              queue.push({ id: dep, changedProp: 'frequency' });
            }
          }
        }

        // Notes whose duration depends on current's startTime -> their DURATION changes
        const durOnSt = this.durationOnStartTimeDependents.get(current);
        if (durOnSt) {
          for (const dep of durOnSt) {
            if (dep !== noteId) {
              result.add(dep);
              queue.push({ id: dep, changedProp: 'duration' });
            }
          }
        }
      } else if (changedProp === 'duration') {
        // Notes whose startTime depends on current's duration -> they MOVE
        const stOnDur = this.startTimeOnDurationDependents.get(current);
        if (stOnDur) {
          for (const dep of stOnDur) {
            if (dep !== noteId) {
              result.add(dep);
              queue.push({ id: dep, changedProp: 'startTime' });
            }
          }
        }

        // Notes whose frequency depends on current's duration -> their FREQUENCY changes
        const freqOnDur = this.frequencyOnDurationDependents.get(current);
        if (freqOnDur) {
          for (const dep of freqOnDur) {
            if (dep !== noteId) {
              result.add(dep);
              queue.push({ id: dep, changedProp: 'frequency' });
            }
          }
        }

        // Notes whose duration depends on current's duration -> their DURATION changes
        const durOnDur = this.durationOnDurationDependents.get(current);
        if (durOnDur) {
          for (const dep of durOnDur) {
            if (dep !== noteId) {
              result.add(dep);
              queue.push({ id: dep, changedProp: 'duration' });
            }
          }
        }
      }
    }

    return result;
  }

  /**
   * Get all notes transitively affected when this note's DURATION changes.
   *
   * @param {number} noteId
   * @returns {Set<number>}
   */
  getAllAffectedByDurationChange(noteId) {
    const result = new Set();
    const queue = [{ id: noteId, changedProp: 'duration' }];
    let queueIdx = 0;
    const visited = new Map();

    while (queueIdx < queue.length) {
      const { id: current, changedProp } = queue[queueIdx++];

      if (!visited.has(current)) {
        visited.set(current, new Set());
      }
      if (visited.get(current).has(changedProp)) {
        continue;
      }
      visited.get(current).add(changedProp);

      if (changedProp === 'frequency') {
        const stOnFreq = this.startTimeOnFrequencyDependents.get(current);
        if (stOnFreq) {
          for (const dep of stOnFreq) {
            if (dep !== noteId) { result.add(dep); queue.push({ id: dep, changedProp: 'startTime' }); }
          }
        }
        const freqOnFreq = this.frequencyOnFrequencyDependents.get(current);
        if (freqOnFreq) {
          for (const dep of freqOnFreq) {
            if (dep !== noteId) { result.add(dep); queue.push({ id: dep, changedProp: 'frequency' }); }
          }
        }
        const durOnFreq = this.durationOnFrequencyDependents.get(current);
        if (durOnFreq) {
          for (const dep of durOnFreq) {
            if (dep !== noteId) { result.add(dep); queue.push({ id: dep, changedProp: 'duration' }); }
          }
        }
      } else if (changedProp === 'startTime') {
        const stOnSt = this.startTimeOnStartTimeDependents.get(current);
        if (stOnSt) {
          for (const dep of stOnSt) {
            if (dep !== noteId) { result.add(dep); queue.push({ id: dep, changedProp: 'startTime' }); }
          }
        }
        const freqOnSt = this.frequencyOnStartTimeDependents.get(current);
        if (freqOnSt) {
          for (const dep of freqOnSt) {
            if (dep !== noteId) { result.add(dep); queue.push({ id: dep, changedProp: 'frequency' }); }
          }
        }
        const durOnSt = this.durationOnStartTimeDependents.get(current);
        if (durOnSt) {
          for (const dep of durOnSt) {
            if (dep !== noteId) { result.add(dep); queue.push({ id: dep, changedProp: 'duration' }); }
          }
        }
      } else if (changedProp === 'duration') {
        const stOnDur = this.startTimeOnDurationDependents.get(current);
        if (stOnDur) {
          for (const dep of stOnDur) {
            if (dep !== noteId) { result.add(dep); queue.push({ id: dep, changedProp: 'startTime' }); }
          }
        }
        const freqOnDur = this.frequencyOnDurationDependents.get(current);
        if (freqOnDur) {
          for (const dep of freqOnDur) {
            if (dep !== noteId) { result.add(dep); queue.push({ id: dep, changedProp: 'frequency' }); }
          }
        }
        const durOnDur = this.durationOnDurationDependents.get(current);
        if (durOnDur) {
          for (const dep of durOnDur) {
            if (dep !== noteId) { result.add(dep); queue.push({ id: dep, changedProp: 'duration' }); }
          }
        }
      }
    }

    return result;
  }

  /**
   * Get all notes transitively affected when this note's STARTTIME changes.
   *
   * @param {number} noteId
   * @returns {Set<number>}
   */
  getAllAffectedByStartTimeChange(noteId) {
    const result = new Set();
    const queue = [{ id: noteId, changedProp: 'startTime' }];
    let queueIdx = 0;
    const visited = new Map();

    while (queueIdx < queue.length) {
      const { id: current, changedProp } = queue[queueIdx++];

      if (!visited.has(current)) {
        visited.set(current, new Set());
      }
      if (visited.get(current).has(changedProp)) {
        continue;
      }
      visited.get(current).add(changedProp);

      if (changedProp === 'frequency') {
        const stOnFreq = this.startTimeOnFrequencyDependents.get(current);
        if (stOnFreq) {
          for (const dep of stOnFreq) {
            if (dep !== noteId) { result.add(dep); queue.push({ id: dep, changedProp: 'startTime' }); }
          }
        }
        const freqOnFreq = this.frequencyOnFrequencyDependents.get(current);
        if (freqOnFreq) {
          for (const dep of freqOnFreq) {
            if (dep !== noteId) { result.add(dep); queue.push({ id: dep, changedProp: 'frequency' }); }
          }
        }
        const durOnFreq = this.durationOnFrequencyDependents.get(current);
        if (durOnFreq) {
          for (const dep of durOnFreq) {
            if (dep !== noteId) { result.add(dep); queue.push({ id: dep, changedProp: 'duration' }); }
          }
        }
      } else if (changedProp === 'startTime') {
        const stOnSt = this.startTimeOnStartTimeDependents.get(current);
        if (stOnSt) {
          for (const dep of stOnSt) {
            if (dep !== noteId) { result.add(dep); queue.push({ id: dep, changedProp: 'startTime' }); }
          }
        }
        const freqOnSt = this.frequencyOnStartTimeDependents.get(current);
        if (freqOnSt) {
          for (const dep of freqOnSt) {
            if (dep !== noteId) { result.add(dep); queue.push({ id: dep, changedProp: 'frequency' }); }
          }
        }
        const durOnSt = this.durationOnStartTimeDependents.get(current);
        if (durOnSt) {
          for (const dep of durOnSt) {
            if (dep !== noteId) { result.add(dep); queue.push({ id: dep, changedProp: 'duration' }); }
          }
        }
      } else if (changedProp === 'duration') {
        const stOnDur = this.startTimeOnDurationDependents.get(current);
        if (stOnDur) {
          for (const dep of stOnDur) {
            if (dep !== noteId) { result.add(dep); queue.push({ id: dep, changedProp: 'startTime' }); }
          }
        }
        const freqOnDur = this.frequencyOnDurationDependents.get(current);
        if (freqOnDur) {
          for (const dep of freqOnDur) {
            if (dep !== noteId) { result.add(dep); queue.push({ id: dep, changedProp: 'frequency' }); }
          }
        }
        const durOnDur = this.durationOnDurationDependents.get(current);
        if (durOnDur) {
          for (const dep of durOnDur) {
            if (dep !== noteId) { result.add(dep); queue.push({ id: dep, changedProp: 'duration' }); }
          }
        }
      }
    }

    return result;
  }

  /**
   * Get all transitive dependencies (what this note depends on, transitively)
   *
   * @param {number} noteId
   * @returns {Set<number>}
   */
  getAllDependencies(noteId) {
    const result = new Set();
    const queue = [noteId];
    let queueIdx = 0; // Use index instead of shift() for O(1)
    const visited = new Set([noteId]);

    while (queueIdx < queue.length) {
      const current = queue[queueIdx++];
      const directDeps = this.dependencies.get(current);

      if (directDeps) {
        for (const dep of directDeps) {
          if (!visited.has(dep)) {
            visited.add(dep);
            result.add(dep);
            queue.push(dep);
          }
        }
      }
    }

    return result;
  }

  /**
   * Get all notes that depend on baseNote
   *
   * @returns {Set<number>}
   */
  getBaseNoteDependents() {
    return new Set(this.baseNoteDependents);
  }

  /**
   * Check if there's a dependency path from source to target
   *
   * @param {number} source
   * @param {number} target
   * @returns {boolean}
   */
  hasDependencyPath(source, target) {
    const queue = [source];
    let queueIdx = 0; // Use index instead of shift() for O(1)
    const visited = new Set([source]);

    while (queueIdx < queue.length) {
      const current = queue[queueIdx++];
      const deps = this.dependencies.get(current);

      if (deps) {
        if (deps.has(target)) return true;

        for (const dep of deps) {
          if (!visited.has(dep)) {
            visited.add(dep);
            queue.push(dep);
          }
        }
      }
    }

    return false;
  }

  /**
   * Detect cycles in the dependency graph
   *
   * @returns {Array<Array<number>>} - Array of cycles (each cycle is an array of note IDs)
   */
  detectCycles() {
    const cycles = [];
    const visited = new Set();
    const recursionStack = new Set();
    const path = [];

    const dfs = (noteId) => {
      visited.add(noteId);
      recursionStack.add(noteId);
      path.push(noteId);

      const deps = this.dependencies.get(noteId);
      if (deps) {
        for (const dep of deps) {
          if (!visited.has(dep)) {
            dfs(dep);
          } else if (recursionStack.has(dep)) {
            // Found a cycle
            const cycleStart = path.indexOf(dep);
            cycles.push(path.slice(cycleStart).concat(dep));
          }
        }
      }

      path.pop();
      recursionStack.delete(noteId);
    };

    for (const noteId of this.dependencies.keys()) {
      if (!visited.has(noteId)) {
        dfs(noteId);
      }
    }

    return cycles;
  }

  /**
   * Get evaluation order (topological sort of all notes)
   *
   * @param {Iterable<number>} noteIds - Notes to sort
   * @returns {Array<number>} - Sorted note IDs
   */
  getEvaluationOrder(noteIds) {
    const noteSet = new Set(noteIds);
    const inDegree = new Map();
    const result = [];

    // Calculate in-degrees
    for (const id of noteSet) {
      const deps = this.dependencies.get(id) || new Set();
      let count = 0;
      for (const d of deps) {
        if (noteSet.has(d)) count++;
      }
      inDegree.set(id, count);
    }

    // Start with nodes that have no dependencies
    const queue = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }

    // Process in order - use index instead of shift() for O(1)
    let queueIdx = 0;
    while (queueIdx < queue.length) {
      const id = queue[queueIdx++];
      result.push(id);

      const dependents = this.dependents.get(id);
      if (dependents) {
        for (const dep of dependents) {
          if (!inDegree.has(dep)) continue;
          const newDeg = inDegree.get(dep) - 1;
          inDegree.set(dep, newDeg);
          if (newDeg === 0) queue.push(dep);
        }
      }
    }

    return result;
  }

  /**
   * Get the children tree as edges for a specific property, with cross-property traversal.
   * Used for visualizing the complete dependent tree per variable.
   *
   * This traverses all dependency paths that originate from changing the given property,
   * following cross-property dependencies (e.g., a frequency change can affect startTime
   * of another note, which in turn affects startTime of its dependents).
   *
   * @param {number} noteId - The root note to start from
   * @param {string} property - 'frequency' | 'startTime' | 'duration'
   * @returns {{ edges: Array<{parentId: number, childId: number, depth: number}>, maxDepth: number }}
   */
  getChildrenTreeByProperty(noteId, property) {
    const edges = [];
    // Track visited as Map<noteId, Set<propertyThatCausedVisit>> to allow revisiting
    // with different property contexts while avoiding infinite loops
    const visited = new Map();
    visited.set(noteId, new Set([property]));

    const queue = [{ id: noteId, depth: 0, changedProp: property }];
    let queueIdx = 0;
    let maxDepth = 0;

    // Helper to add edge and queue child if not visited with this property
    const addEdge = (parentId, childId, depth, childChangedProp) => {
      if (!visited.has(childId)) {
        visited.set(childId, new Set());
      }
      // Only process if we haven't visited this child with this specific property change
      if (!visited.get(childId).has(childChangedProp)) {
        visited.get(childId).add(childChangedProp);
        maxDepth = Math.max(maxDepth, depth);
        edges.push({ parentId, childId, depth });
        queue.push({ id: childId, depth, changedProp: childChangedProp });
      }
    };

    while (queueIdx < queue.length) {
      const { id: parentId, depth, changedProp } = queue[queueIdx++];
      const childDepth = depth + 1;

      // Based on which property changed on the parent, find all affected children
      // This mirrors the logic in getAllAffectedBy*Change methods
      if (changedProp === 'frequency') {
        // Notes whose startTime depends on parent's frequency -> they MOVE
        const stOnFreq = this.startTimeOnFrequencyDependents.get(parentId);
        if (stOnFreq) {
          for (const childId of stOnFreq) {
            if (childId !== noteId) addEdge(parentId, childId, childDepth, 'startTime');
          }
        }
        // Notes whose frequency depends on parent's frequency -> their FREQUENCY changes
        const freqOnFreq = this.frequencyOnFrequencyDependents.get(parentId);
        if (freqOnFreq) {
          for (const childId of freqOnFreq) {
            if (childId !== noteId) addEdge(parentId, childId, childDepth, 'frequency');
          }
        }
        // Notes whose duration depends on parent's frequency -> their DURATION changes
        const durOnFreq = this.durationOnFrequencyDependents.get(parentId);
        if (durOnFreq) {
          for (const childId of durOnFreq) {
            if (childId !== noteId) addEdge(parentId, childId, childDepth, 'duration');
          }
        }
      } else if (changedProp === 'startTime') {
        // Notes whose startTime depends on parent's startTime -> they MOVE
        const stOnSt = this.startTimeOnStartTimeDependents.get(parentId);
        if (stOnSt) {
          for (const childId of stOnSt) {
            if (childId !== noteId) addEdge(parentId, childId, childDepth, 'startTime');
          }
        }
        // Notes whose frequency depends on parent's startTime -> their FREQUENCY changes
        const freqOnSt = this.frequencyOnStartTimeDependents.get(parentId);
        if (freqOnSt) {
          for (const childId of freqOnSt) {
            if (childId !== noteId) addEdge(parentId, childId, childDepth, 'frequency');
          }
        }
        // Notes whose duration depends on parent's startTime -> their DURATION changes
        const durOnSt = this.durationOnStartTimeDependents.get(parentId);
        if (durOnSt) {
          for (const childId of durOnSt) {
            if (childId !== noteId) addEdge(parentId, childId, childDepth, 'duration');
          }
        }
      } else if (changedProp === 'duration') {
        // Notes whose startTime depends on parent's duration -> they MOVE
        const stOnDur = this.startTimeOnDurationDependents.get(parentId);
        if (stOnDur) {
          for (const childId of stOnDur) {
            if (childId !== noteId) addEdge(parentId, childId, childDepth, 'startTime');
          }
        }
        // Notes whose frequency depends on parent's duration -> their FREQUENCY changes
        const freqOnDur = this.frequencyOnDurationDependents.get(parentId);
        if (freqOnDur) {
          for (const childId of freqOnDur) {
            if (childId !== noteId) addEdge(parentId, childId, childDepth, 'frequency');
          }
        }
        // Notes whose duration depends on parent's duration -> their DURATION changes
        const durOnDur = this.durationOnDurationDependents.get(parentId);
        if (durOnDur) {
          for (const childId of durOnDur) {
            if (childId !== noteId) addEdge(parentId, childId, childDepth, 'duration');
          }
        }
      }
    }

    return { edges, maxDepth };
  }

  /**
   * Clear the entire graph
   */
  clear() {
    this.dependencies.clear();
    this.dependents.clear();
    this.baseNoteDependents.clear();
    this.startTimeDependencies.clear();
    this.startTimeDependents.clear();
    this.startTimeBaseNoteDependents.clear();
    this.startTimeOnStartTimeDependents.clear();
    this.startTimeOnDurationDependents.clear();
    this.startTimeOnFrequencyDependents.clear();
    // Frequency-specific
    this.frequencyDependencies.clear();
    this.frequencyDependents.clear();
    this.frequencyBaseNoteDependents.clear();
    this.frequencyOnStartTimeDependents.clear();
    this.frequencyOnDurationDependents.clear();
    this.frequencyOnFrequencyDependents.clear();
    // Duration-specific
    this.durationDependencies.clear();
    this.durationDependents.clear();
    this.durationBaseNoteDependents.clear();
    this.durationOnStartTimeDependents.clear();
    this.durationOnDurationDependents.clear();
    this.durationOnFrequencyDependents.clear();
    // Corruption tracking
    this.corruptionFlags.clear();
  }

  /**
   * Set corruption flags for a note
   * Called after evaluation to record which properties contain irrational values
   *
   * @param {number} noteId - The note ID
   * @param {number} flags - Bitmask of corrupted properties (0x01=startTime, 0x02=duration, 0x04=frequency, etc.)
   */
  setCorruptionFlags(noteId, flags) {
    if (flags === 0) {
      this.corruptionFlags.delete(noteId);
    } else {
      this.corruptionFlags.set(noteId, flags);
    }
  }

  /**
   * Get corruption flags for a note
   *
   * @param {number} noteId - The note ID
   * @returns {number} - Bitmask of corrupted properties (0 if not corrupted)
   */
  getCorruptionFlags(noteId) {
    return this.corruptionFlags.get(noteId) || 0;
  }

  /**
   * Check if a note has any corrupted properties
   *
   * @param {number} noteId - The note ID
   * @returns {boolean} - True if any property is corrupted
   */
  isNoteCorrupted(noteId) {
    return this.corruptionFlags.has(noteId) && this.corruptionFlags.get(noteId) !== 0;
  }

  /**
   * Check if a specific property of a note is corrupted
   *
   * @param {number} noteId - The note ID
   * @param {number} propertyFlag - The property flag to check (e.g., 0x04 for frequency)
   * @returns {boolean} - True if the property is corrupted
   */
  isPropertyCorrupted(noteId, propertyFlag) {
    const flags = this.corruptionFlags.get(noteId) || 0;
    return (flags & propertyFlag) !== 0;
  }

  /**
   * Clear corruption flags for a note
   *
   * @param {number} noteId - The note ID
   */
  clearCorruptionFlags(noteId) {
    this.corruptionFlags.delete(noteId);
  }

  /**
   * Get all corrupted note IDs
   *
   * @returns {Set<number>} - Set of note IDs that have corruption
   */
  getCorruptedNotes() {
    const result = new Set();
    for (const [noteId, flags] of this.corruptionFlags) {
      if (flags !== 0) {
        result.add(noteId);
      }
    }
    return result;
  }

  /**
   * Check if a note's frequency is transitively corrupted
   * (either directly corrupted or depends on a corrupted frequency)
   *
   * @param {number} noteId - The note ID
   * @returns {boolean} - True if frequency is transitively corrupted
   */
  isFrequencyTransitivelyCorrupted(noteId) {
    // Check direct corruption first (fast path)
    if (this.isPropertyCorrupted(noteId, 0x04)) return true;

    // BFS through frequency dependency chain
    const visited = new Set([noteId]);
    const queue = [noteId];
    let idx = 0;

    while (idx < queue.length) {
      const freqDeps = this.frequencyDependencies.get(queue[idx++]);
      if (freqDeps) {
        for (const depId of freqDeps) {
          if (visited.has(depId)) continue;
          visited.add(depId);
          if (this.isPropertyCorrupted(depId, 0x04)) return true;
          queue.push(depId);
        }
      }
    }
    return false;
  }

  /**
   * Get all transitive frequency dependencies (notes that affect this note's frequency)
   *
   * @param {number} noteId - The note ID
   * @returns {Set<number>} - Set of note IDs that this note's frequency depends on
   */
  getAllFrequencyDependencies(noteId) {
    const result = new Set();
    const queue = [noteId];
    let idx = 0;
    const visited = new Set([noteId]);

    while (idx < queue.length) {
      const freqDeps = this.frequencyDependencies.get(queue[idx++]);
      if (freqDeps) {
        for (const dep of freqDeps) {
          if (!visited.has(dep)) {
            visited.add(dep);
            result.add(dep);
            queue.push(dep);
          }
        }
      }
    }
    return result;
  }

  /**
   * Get statistics about the graph
   */
  stats() {
    let totalDeps = 0;
    let maxDeps = 0;
    let maxDependents = 0;

    for (const deps of this.dependencies.values()) {
      totalDeps += deps.size;
      maxDeps = Math.max(maxDeps, deps.size);
    }

    for (const deps of this.dependents.values()) {
      maxDependents = Math.max(maxDependents, deps.size);
    }

    return {
      noteCount: this.dependencies.size,
      totalDependencies: totalDeps,
      avgDependencies: this.dependencies.size > 0 ? (totalDeps / this.dependencies.size).toFixed(2) : 0,
      maxDependencies: maxDeps,
      maxDependents: maxDependents,
      baseNoteDependents: this.baseNoteDependents.size,
      corruptedNotes: this.corruptionFlags.size,
    };
  }

  /**
   * Get measure chain for a given measure note.
   * Returns the linear chain from earliest ancestor to all downstream dependents.
   * O(d) where d = chain length, using pre-computed inverted index.
   *
   * @param {number} measureId - The measure note ID
   * @param {function} isMeasure - Predicate to check if a note is a measure
   * @param {function} getStartTime - Function to get evaluated startTime for a note
   * @param {function} [isChainLink] - Optional predicate (depId, parentId) => boolean to check if a dependent is a chain link (not anchor)
   * @returns {Array<{id: number, startSec: number}>} - Chain from earliest to latest
   */
  getMeasureChain(measureId, isMeasure, getStartTime, isChainLink = null) {
    // Step 1: Walk backward to find the earliest ancestor measure IN THIS CHAIN
    // Only walk backward through chain links (isChainLink returns true), not anchors
    let cur = measureId;
    let guard = 0;
    while (guard++ < 1024) {
      const deps = this.dependencies.get(cur);
      if (!deps || deps.size === 0) break;

      // Find a measure dependency that this note is a CHAIN LINK to (not just an anchor)
      let foundParent = null;
      for (const depId of deps) {
        if (depId === 0) continue; // Skip baseNote
        if (isMeasure(depId)) {
          // Only walk backward if current note is a chain link to this parent
          // If isChainLink callback not provided, fall back to old behavior
          if (!isChainLink || isChainLink(cur, depId)) {
            foundParent = depId;
            break;
          }
        }
      }
      if (foundParent === null) break; // Stop at anchors or roots
      cur = foundParent;
    }

    // Step 2: Build chain forward from earliest ancestor
    const chain = [];
    const visited = new Set();

    const pushWithStart = (id) => {
      const t = getStartTime(id);
      chain.push({ id, startSec: t });
    };

    pushWithStart(cur);
    visited.add(cur);

    // Walk forward: at each step, pick the next CHAIN LINK measure (not anchors from other chains)
    // If isChainLink callback is provided, use it to filter dependents
    guard = 0;
    while (guard++ < 2048) {
      const dependents = this.dependents.get(cur);
      if (!dependents || dependents.size === 0) break;

      // Find chain link dependents (measures that are true chain links, not anchors)
      const chainLinkDeps = [];
      for (const depId of dependents) {
        if (!visited.has(depId) && isMeasure(depId)) {
          // If isChainLink callback is provided, only include chain links
          if (isChainLink && !isChainLink(depId, cur)) {
            continue; // Skip anchors (they start their own chains)
          }
          chainLinkDeps.push({ id: depId, startSec: getStartTime(depId) });
        }
      }

      if (chainLinkDeps.length === 0) break;

      // Sort by startTime and pick earliest (there should typically be only one chain link)
      chainLinkDeps.sort((a, b) => a.startSec - b.startSec);
      const next = chainLinkDeps[0];

      pushWithStart(next.id);
      visited.add(next.id);
      cur = next.id;
    }

    return chain;
  }

  /**
   * Debug: Print the graph structure
   */
  debug() {
    console.log('=== Dependency Graph ===');
    console.log('Forward (dependencies):');
    for (const [id, deps] of this.dependencies) {
      console.log(`  Note ${id} -> [${[...deps].join(', ')}]`);
    }
    console.log('Inverse (dependents):');
    for (const [id, deps] of this.dependents) {
      console.log(`  Note ${id} <- [${[...deps].join(', ')}]`);
    }
    console.log(`BaseNote dependents: [${[...this.baseNoteDependents].join(', ')}]`);
    console.log('Stats:', this.stats());
  }
}

export default DependencyGraph;
