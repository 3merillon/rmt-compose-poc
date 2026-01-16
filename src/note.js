import { eventBus } from './utils/event-bus.js';
import { BinaryExpression } from './binary-note.js';
import { compiler, decompiler } from './expression-compiler.js';

/**
 * Note class - Binary-native implementation
 *
 * Stores expressions as compiled BinaryExpressions and evaluates
 * through the module's binary evaluator.
 */
export class Note {
  constructor(id, variables = {}) {
    this.id = id;
    this.module = null;
    this.lastModifiedTime = Date.now();

    // Expression storage (BinaryExpression objects)
    this.expressions = {
      startTime: new BinaryExpression(),
      duration: new BinaryExpression(),
      frequency: new BinaryExpression(),
      tempo: new BinaryExpression(),
      beatsPerMeasure: new BinaryExpression(),
      measureLength: new BinaryExpression(),
    };

    // Non-expression properties
    this.properties = {
      color: null,
      instrument: id === 0 ? 'sine-wave' : null,
    };

    // Initialize from variables (supports both legacy and new formats)
    this._initFromVariables(variables);
  }

  /**
   * Initialize note from a variables object
   * Handles both legacy format (*String properties, functions) and new format
   */
  _initFromVariables(variables) {
    const expressionVars = ['startTime', 'duration', 'frequency', 'tempo', 'beatsPerMeasure', 'measureLength'];

    for (const [key, value] of Object.entries(variables)) {
      // Skip legacy *String properties - we'll use them as source
      if (key.endsWith('String')) continue;

      // Handle expression variables
      if (expressionVars.includes(key)) {
        const stringKey = key + 'String';
        let exprText = null;

        // Prefer *String property if available
        if (variables[stringKey] && typeof variables[stringKey] === 'string') {
          exprText = variables[stringKey];
        } else if (typeof value === 'string') {
          // Direct string value
          exprText = value;
        } else if (typeof value === 'function') {
          // Try to extract expression from function
          try {
            const funcStr = value.toString();
            const match = funcStr.match(/return\s+(.+?);?\s*\}?\s*$/);
            if (match) {
              exprText = match[1];
            }
          } catch (e) {
            // Ignore extraction failures
          }
        } else if (value && typeof value === 'object' && value instanceof BinaryExpression) {
          // Already a BinaryExpression
          this.expressions[key] = value;
          continue;
        }

        // Compile expression text to binary
        if (exprText) {
          try {
            this.expressions[key] = compiler.compile(exprText, key);
          } catch (e) {
            console.warn(`Failed to compile ${key} expression for note ${this.id}:`, e);
          }
        }
        continue;
      }

      // Handle non-expression properties
      if (key === 'color' || key === 'instrument') {
        this.properties[key] = value;
      }
    }
  }

  /**
   * Get the evaluated value of a variable
   * Uses the module's binary evaluator to compute the result
   */
  getVariable(name) {
    // Handle non-expression properties
    if (name === 'color') return this.properties.color;
    if (name === 'instrument') return this.properties.instrument;

    // Handle *String requests - return source text
    if (name.endsWith('String')) {
      const baseName = name.slice(0, -6);
      return this.getExpressionSource(baseName);
    }

    // Get evaluated value from module's cache
    if (this.module) {
      const cache = this.module.getEvaluationCache();
      if (cache) {
        const noteCache = cache.get(this.id);
        if (noteCache && noteCache[name] !== undefined && noteCache[name] !== null) {
          return noteCache[name];
        }
      }

      // If not in cache, try to evaluate
      return this.module.evaluateNoteVariable(this.id, name);
    }

    return null;
  }

  /**
   * Set a variable value
   * Compiles expression text to binary and triggers re-evaluation
   */
  setVariable(name, value) {
    this.lastModifiedTime = Date.now();

    // Handle non-expression properties
    if (name === 'color') {
      this.properties.color = value;
      this._notifyChange();
      return;
    }
    if (name === 'instrument') {
      this.properties.instrument = value;
      this._notifyChange();
      return;
    }

    // Handle *String properties - compile to binary
    if (name.endsWith('String')) {
      const baseName = name.slice(0, -6);
      if (typeof value === 'string') {
        this._setExpression(baseName, value);
      }
      return;
    }

    // Handle expression variables
    const expressionVars = ['startTime', 'duration', 'frequency', 'tempo', 'beatsPerMeasure', 'measureLength'];
    if (expressionVars.includes(name)) {
      if (typeof value === 'string') {
        // Expression text
        this._setExpression(name, value);
      } else if (typeof value === 'function') {
        // Legacy function - try to extract expression
        try {
          const funcStr = value.toString();
          const match = funcStr.match(/return\s+(.+?);?\s*\}?\s*$/);
          if (match) {
            this._setExpression(name, match[1]);
          }
        } catch (e) {
          console.warn(`Failed to extract expression from function for ${name}:`, e);
        }
      } else if (value instanceof BinaryExpression) {
        this.expressions[name] = value;
        this._notifyChange();
      }
      return;
    }
  }

  /**
   * Internal: Set expression from text
   */
  _setExpression(name, exprText) {
    try {
      this.expressions[name] = compiler.compile(exprText, name);
      this._notifyChange();
    } catch (e) {
      console.warn(`Failed to compile expression for ${name}:`, e);
    }
  }

  /**
   * Internal: Notify module of change
   */
  _notifyChange() {
    if (this.module && typeof this.module.markNoteDirty === 'function') {
      this.module.markNoteDirty(this.id);
    }
    try {
      eventBus.emit('player:invalidateModuleEndTimeCache');
    } catch (e) {
      // Ignore event bus errors
    }
  }

  /**
   * Get the source text of an expression
   */
  getExpressionSource(name) {
    const expr = this.expressions[name];
    if (expr && !expr.isEmpty()) {
      return expr.sourceText || decompiler.decompile(expr);
    }
    return null;
  }

  /**
   * Get the BinaryExpression for a variable
   */
  getExpression(name) {
    return this.expressions[name] || null;
  }

  /**
   * Check if note has a specific expression defined
   */
  hasExpression(name) {
    const expr = this.expressions[name];
    return expr && !expr.isEmpty();
  }

  /**
   * Get all evaluated variables (for compatibility)
   * Returns an object with all evaluated values
   */
  getAllVariables() {
    const result = {};

    // Add evaluated expression values
    const expressionVars = ['startTime', 'duration', 'frequency', 'tempo', 'beatsPerMeasure', 'measureLength'];
    for (const name of expressionVars) {
      const value = this.getVariable(name);
      if (value !== null) {
        result[name] = value;
      }
      // Also include source strings for compatibility
      const source = this.getExpressionSource(name);
      if (source) {
        result[name + 'String'] = source;
      }
    }

    // Add properties
    if (this.properties.color) result.color = this.properties.color;
    if (this.properties.instrument) result.instrument = this.properties.instrument;

    return result;
  }

  /**
   * Convert note to JSON for serialization
   */
  toJSON() {
    const obj = { id: this.id };

    // Decompile expressions to text
    for (const [name, expr] of Object.entries(this.expressions)) {
      if (expr && !expr.isEmpty()) {
        obj[name] = decompiler.decompile(expr);
      }
    }

    // Add properties
    if (this.properties.color) obj.color = this.properties.color;
    if (this.properties.instrument) obj.instrument = this.properties.instrument;

    return obj;
  }

  /**
   * Get all dependencies of this note (note IDs referenced in expressions)
   */
  getAllDependencies() {
    const deps = new Set();
    for (const expr of Object.values(this.expressions)) {
      if (expr && expr.depCount > 0) {
        for (let i = 0; i < expr.depCount; i++) {
          deps.add(expr.dependencies[i]);
        }
      }
    }
    return deps;
  }

  /**
   * Check if any expression references the base note
   */
  referencesBaseNote() {
    for (const expr of Object.values(this.expressions)) {
      if (expr && expr.referencesBase) {
        return true;
      }
    }
    return false;
  }

  // ============ Legacy compatibility layer ============
  // These provide backwards compatibility during migration

  /**
   * Legacy: Access variables object (for compatibility)
   * Creates a proxy that maps to the new structure
   */
  get variables() {
    const note = this;
    return new Proxy({}, {
      get(target, prop) {
        // Handle *String properties
        if (typeof prop === 'string' && prop.endsWith('String')) {
          const baseName = prop.slice(0, -6);
          return note.getExpressionSource(baseName);
        }
        // Handle expression variables - return a function wrapper for legacy code
        // Only return a function if the expression actually exists
        const expressionVars = ['startTime', 'duration', 'frequency', 'tempo', 'beatsPerMeasure', 'measureLength'];
        if (expressionVars.includes(prop)) {
          // Check if this expression actually exists
          if (!note.hasExpression(prop)) {
            return undefined;
          }
          // Create a function that includes the variable name directly in its source
          // This is important because legacy code may call .toString() on the function
          // and try to extract the expression from it
          const varName = prop;
          const fn = function() {
            return note.getVariable(varName);
          };
          // Override toString to return a proper expression string that can be parsed
          fn.toString = () => {
            // Return the source expression if available, otherwise return a Fraction wrapper
            const source = note.getExpressionSource(varName);
            if (source) return source;
            // Fallback: return a representation that indicates the variable name
            return `module.getNoteById(${note.id}).getVariable('${varName}')`;
          };
          return fn;
        }
        // Handle properties
        if (prop === 'color') return note.properties.color;
        if (prop === 'instrument') return note.properties.instrument;
        return undefined;
      },
      set(target, prop, value) {
        note.setVariable(prop, value);
        return true;
      },
      has(target, prop) {
        if (prop === 'color' || prop === 'instrument') {
          return note.properties[prop] !== null;
        }
        if (typeof prop === 'string' && prop.endsWith('String')) {
          const baseName = prop.slice(0, -6);
          return note.hasExpression(baseName);
        }
        const expressionVars = ['startTime', 'duration', 'frequency', 'tempo', 'beatsPerMeasure', 'measureLength'];
        if (expressionVars.includes(prop)) {
          return note.hasExpression(prop);
        }
        return false;
      },
      ownKeys(target) {
        const keys = [];
        const expressionVars = ['startTime', 'duration', 'frequency', 'tempo', 'beatsPerMeasure', 'measureLength'];
        for (const name of expressionVars) {
          if (note.hasExpression(name)) {
            keys.push(name);
            keys.push(name + 'String');
          }
        }
        if (note.properties.color) keys.push('color');
        if (note.properties.instrument) keys.push('instrument');
        return keys;
      },
      getOwnPropertyDescriptor(target, prop) {
        // Required for Object.keys() to work with Proxy
        const keys = this.ownKeys(target);
        if (keys.includes(prop)) {
          return { enumerable: true, configurable: true };
        }
        return undefined;
      }
    });
  }
}
