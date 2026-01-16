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
    this._updateStartTimeDependencies(noteId, newDeps, referencesBase);

    // Also update property-specific tracking
    const propDeps = startTimeExpr ? startTimeExpr.getPropertyDependencies() : new Map();
    this._updateStartTimePropertyDependencies(noteId, propDeps);
  }

  /**
   * Internal: Update property-specific startTime dependency tracking
   * Tracks which notes' startTime depends on another note's startTime vs duration
   */
  _updateStartTimePropertyDependencies(noteId, newPropDeps) {
    // VAR indices: 0 = startTime, 1 = duration
    const VAR_START_TIME = 0;
    const VAR_DURATION = 1;

    // Helper to update a specific property inverse map
    const updatePropertyMap = (propMap, depNoteId, varIndex, newPropDeps) => {
      const newNoteProps = newPropDeps.get(depNoteId);
      const shouldHave = newNoteProps && newNoteProps.has(varIndex);

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

    // Get all notes that could be affected (union of old and new deps)
    const allDepNotes = new Set([
      ...this.startTimeDependencies.get(noteId) || [],
      ...newPropDeps.keys()
    ]);

    for (const depNoteId of allDepNotes) {
      updatePropertyMap(this.startTimeOnStartTimeDependents, depNoteId, VAR_START_TIME, newPropDeps);
      updatePropertyMap(this.startTimeOnDurationDependents, depNoteId, VAR_DURATION, newPropDeps);
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

    // Remove this note from other notes' property-specific dependent sets
    for (const [, depSet] of this.startTimeOnStartTimeDependents) {
      depSet.delete(noteId);
    }
    for (const [, depSet] of this.startTimeOnDurationDependents) {
      depSet.delete(noteId);
    }
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
