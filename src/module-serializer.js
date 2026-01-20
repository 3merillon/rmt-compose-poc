/**
 * Module Serializer: JSON Import/Export
 *
 * Handles conversion between the binary module format and the JSON format
 * used for saving/loading modules, maintaining backwards compatibility.
 *
 * Supports both DSL format and legacy JavaScript-style format for loading.
 * Saves in DSL format by default for better readability.
 */

import { BinaryModule, BinaryNote, BinaryExpression } from './binary-note.js';
import { ExpressionCompiler, ExpressionDecompiler } from './expression-compiler.js';
import { DependencyGraph } from './dependency-graph.js';
import { decompileToDSL } from './dsl/index.js';

/**
 * Serializer for converting between binary and JSON formats
 */
export class ModuleSerializer {
  constructor() {
    this.compiler = new ExpressionCompiler();
    this.decompiler = new ExpressionDecompiler();
  }

  /**
   * Convert a binary module to JSON format
   *
   * @param {BinaryModule} module - The binary module
   * @param {boolean} useDSL - If true, serialize to DSL format (default: true)
   * @returns {Object} - JSON-serializable object
   */
  toJSON(module, useDSL = true) {
    const result = {
      baseNote: this.serializeBaseNote(module.baseNote, useDSL),
      notes: []
    };

    // Serialize all notes (excluding base note)
    for (const [id, note] of module.notes) {
      if (id === 0) continue; // Skip base note (serialized separately)

      result.notes.push(this.serializeNote(note, useDSL));
    }

    return result;
  }

  /**
   * Serialize the base note to JSON
   * @param {BinaryNote} baseNote - The base note
   * @param {boolean} useDSL - If true, serialize to DSL format (default: true)
   */
  serializeBaseNote(baseNote, useDSL = true) {
    const result = {};

    // Serialize each expression variable
    const vars = ['startTime', 'duration', 'frequency', 'tempo', 'beatsPerMeasure', 'measureLength'];
    for (const varName of vars) {
      const expr = baseNote.getExpression(varName);
      if (expr && !expr.isEmpty()) {
        if (useDSL) {
          result[varName] = decompileToDSL(expr);
        } else {
          result[varName] = this.decompiler.decompile(expr);
        }
      }
    }

    return result;
  }

  /**
   * Serialize a note to JSON
   * @param {BinaryNote} note - The note to serialize
   * @param {boolean} useDSL - If true, serialize to DSL format (default: true)
   */
  serializeNote(note, useDSL = true) {
    const result = {
      id: note.id
    };

    // Serialize expression variables
    const vars = ['startTime', 'duration', 'frequency', 'tempo', 'beatsPerMeasure', 'measureLength'];
    for (const varName of vars) {
      const expr = note.getExpression(varName);
      if (expr && !expr.isEmpty()) {
        if (useDSL) {
          result[varName] = decompileToDSL(expr);
        } else {
          result[varName] = this.decompiler.decompile(expr);
        }
      }
    }

    // Serialize non-expression properties
    if (note.color) {
      result.color = note.color;
    }
    if (note.instrument) {
      result.instrument = note.instrument;
    }

    return result;
  }

  /**
   * Load a binary module from JSON data
   *
   * @param {Object} data - The JSON data
   * @param {DependencyGraph} graph - Optional dependency graph to populate
   * @returns {BinaryModule} - The loaded binary module
   */
  fromJSON(data, graph = null) {
    const module = new BinaryModule();

    // Load base note
    if (data.baseNote) {
      this.loadBaseNote(module.baseNote, data.baseNote);
      if (graph) {
        graph.registerNote(0, module.baseNote);
      }
    }

    // Load all notes
    if (data.notes && Array.isArray(data.notes)) {
      for (const noteData of data.notes) {
        const note = this.loadNote(noteData, module);
        module.addNote(note);

        if (graph) {
          graph.registerNote(note.id, note);
        }
      }
    }

    return module;
  }

  /**
   * Load base note from JSON data
   */
  loadBaseNote(baseNote, data) {
    const vars = ['startTime', 'duration', 'frequency', 'tempo', 'beatsPerMeasure', 'measureLength'];

    for (const varName of vars) {
      if (data[varName]) {
        const expr = this.compiler.compile(data[varName], varName);
        baseNote.setExpression(varName, expr);
      }
    }
  }

  /**
   * Load a note from JSON data
   */
  loadNote(data, module) {
    const note = new BinaryNote(data.id);

    // Load expression variables
    const vars = ['startTime', 'duration', 'frequency', 'tempo', 'beatsPerMeasure', 'measureLength'];
    for (const varName of vars) {
      if (data[varName]) {
        const expr = this.compiler.compile(data[varName], varName);
        note.setExpression(varName, expr);
      }
    }

    // Load non-expression properties
    if (data.color) {
      note.color = data.color;
    }
    if (data.instrument) {
      note.instrument = data.instrument;
    }

    // Update next ID counter
    if (data.id >= module._nextId) {
      module._nextId = data.id + 1;
    }

    return note;
  }

  /**
   * Convert legacy module format to binary module
   * This handles the old Note class format with function-backed variables
   *
   * @param {Object} legacyModule - The legacy module object
   * @param {DependencyGraph} graph - Optional dependency graph to populate
   * @returns {BinaryModule} - The converted binary module
   */
  fromLegacyModule(legacyModule, graph = null) {
    const module = new BinaryModule();

    // Convert base note
    if (legacyModule.baseNote) {
      this.convertLegacyNote(legacyModule.baseNote, module.baseNote);
      if (graph) {
        graph.registerNote(0, module.baseNote);
      }
    }

    // Convert all notes
    const notes = legacyModule.notes || legacyModule._notes;
    if (notes) {
      for (const [id, legacyNote] of Object.entries(notes)) {
        const noteId = parseInt(id, 10);
        if (noteId === 0) continue; // Skip base note

        const note = new BinaryNote(noteId);
        this.convertLegacyNote(legacyNote, note);
        module.addNote(note);

        if (graph) {
          graph.registerNote(noteId, note);
        }
      }
    }

    return module;
  }

  /**
   * Convert a legacy note to binary note
   */
  convertLegacyNote(legacyNote, binaryNote) {
    const variables = legacyNote.variables || legacyNote;

    // Convert expression variables
    const varNames = ['startTime', 'duration', 'frequency', 'tempo', 'beatsPerMeasure', 'measureLength'];

    for (const varName of varNames) {
      // Try the String suffix version first (contains the expression text)
      const stringKey = varName + 'String';
      let exprText = null;

      if (variables[stringKey] && typeof variables[stringKey] === 'string') {
        exprText = variables[stringKey];
      } else if (variables[varName]) {
        const value = variables[varName];
        if (typeof value === 'string') {
          exprText = value;
        } else if (typeof value === 'function') {
          // Try to get the expression from function.toString()
          // This is a fallback - the String version should be preferred
          const funcStr = value.toString();
          const match = funcStr.match(/return\s+(.+?);?\s*\}?\s*$/);
          if (match) {
            exprText = match[1];
          }
        }
      }

      if (exprText) {
        const expr = this.compiler.compile(exprText, varName);
        binaryNote.setExpression(varName, expr);
      }
    }

    // Copy non-expression properties
    if (variables.color) {
      binaryNote.color = variables.color;
    }
    if (variables.instrument) {
      binaryNote.instrument = variables.instrument;
    }
  }

  /**
   * Create a JSON string from a binary module
   *
   * @param {BinaryModule} module - The binary module
   * @param {boolean} pretty - Whether to format with indentation
   * @returns {string} - JSON string
   */
  stringify(module, pretty = true) {
    const json = this.toJSON(module);
    return pretty ? JSON.stringify(json, null, 2) : JSON.stringify(json);
  }

  /**
   * Parse a JSON string into a binary module
   *
   * @param {string} jsonString - The JSON string
   * @param {DependencyGraph} graph - Optional dependency graph to populate
   * @returns {BinaryModule} - The parsed binary module
   */
  parse(jsonString, graph = null) {
    const data = JSON.parse(jsonString);
    return this.fromJSON(data, graph);
  }
}

/**
 * GPU synchronization helper for efficient buffer updates
 */
export class GPUSync {
  constructor(renderer) {
    this.renderer = renderer;

    // Constants for position/size calculation
    this.SCALE_X = 200;
    this.SCALE_Y = 100;
    this.NOTE_HEIGHT = 10;
    this.BASE_FREQ = 440; // A4
  }

  /**
   * Update renderer with evaluation cache
   *
   * @param {Map} evaluationCache - noteId -> { startTime, duration, frequency }
   * @param {BinaryModule} module - The binary module for additional note data
   * @param {number} xScaleFactor - X scale factor
   * @param {number} yScaleFactor - Y scale factor
   */
  sync(evaluationCache, module, xScaleFactor = 1, yScaleFactor = 1) {
    if (!this.renderer || !this.renderer.posSize) {
      return;
    }

    const posSize = this.renderer.posSize;
    let idx = 0;

    // Get base frequency for pitch calculation
    const baseFreqCached = evaluationCache.get(0);
    const baseFreq = baseFreqCached?.frequency?.valueOf() || this.BASE_FREQ;

    for (const [noteId, values] of evaluationCache) {
      if (noteId === 0) continue; // Skip base note
      if (!values.startTime || !values.duration || !values.frequency) continue;

      const x = values.startTime.valueOf() * this.SCALE_X * xScaleFactor;
      const w = values.duration.valueOf() * this.SCALE_X * xScaleFactor;
      const y = Math.log2(baseFreq / values.frequency.valueOf()) * this.SCALE_Y * yScaleFactor;
      const h = this.NOTE_HEIGHT;

      // Write to position/size buffer
      const baseIdx = idx * 4;
      posSize[baseIdx + 0] = x;
      posSize[baseIdx + 1] = y;
      posSize[baseIdx + 2] = w;
      posSize[baseIdx + 3] = h;

      idx++;
    }

    // Update GPU buffer
    if (this.renderer.updatePosSize) {
      this.renderer.updatePosSize(idx);
    }

    return idx;
  }

  /**
   * Build instance data for rendering
   *
   * @param {Map} evaluationCache - Evaluation results
   * @param {BinaryModule} module - The binary module
   * @returns {Object} - Instance data { positions, colors, count }
   */
  buildInstanceData(evaluationCache, module) {
    const positions = [];
    const colors = [];
    let count = 0;

    const baseFreqCached = evaluationCache.get(0);
    const baseFreq = baseFreqCached?.frequency?.valueOf() || this.BASE_FREQ;

    for (const [noteId, values] of evaluationCache) {
      if (noteId === 0) continue;
      if (!values.startTime || !values.duration || !values.frequency) continue;

      const note = module.getNoteById(noteId);
      if (!note) continue;

      const x = values.startTime.valueOf() * this.SCALE_X;
      const w = values.duration.valueOf() * this.SCALE_X;
      const y = Math.log2(baseFreq / values.frequency.valueOf()) * this.SCALE_Y;
      const h = this.NOTE_HEIGHT;

      positions.push(x, y, w, h);

      // Parse color
      const color = this.parseColor(note.color);
      colors.push(...color);

      count++;
    }

    return {
      positions: new Float32Array(positions),
      colors: new Float32Array(colors),
      count
    };
  }

  /**
   * Parse a color string to RGBA array
   */
  parseColor(colorStr) {
    if (!colorStr) {
      return [1, 0, 0, 0.5]; // Default red
    }

    // Handle rgba(r, g, b, a) format
    const rgbaMatch = colorStr.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/i);
    if (rgbaMatch) {
      return [
        parseInt(rgbaMatch[1]) / 255,
        parseInt(rgbaMatch[2]) / 255,
        parseInt(rgbaMatch[3]) / 255,
        rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1
      ];
    }

    // Handle hex format
    if (colorStr.startsWith('#')) {
      const hex = colorStr.slice(1);
      if (hex.length === 6) {
        return [
          parseInt(hex.slice(0, 2), 16) / 255,
          parseInt(hex.slice(2, 4), 16) / 255,
          parseInt(hex.slice(4, 6), 16) / 255,
          1
        ];
      }
    }

    return [1, 0, 0, 0.5]; // Default
  }
}

// Export singleton instance for convenience
export const serializer = new ModuleSerializer();
