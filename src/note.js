import { eventBus } from './utils/event-bus.js';
import { BinaryExpression, EMPTY_EXPRESSION } from './binary-note.js';
import { compiler, decompiler } from './expression-compiler.js';

/**
 * The evaluated variables of a note. The first three are the language (each a
 * relation to other notes); the last three interpret the note when it sounds.
 */
export const EXPRESSION_VARS = ['startTime', 'duration', 'frequency', 'amplitude', 'attack', 'release'];

/**
 * Whether a note is a measure bar: a silent note (a start and a duration, no
 * frequency) that the editor draws as a bar line rather than as a rest. The
 * flag is display only; evaluation treats a bar like any other note. Accepts a
 * Note or a plain note object from JSON.
 */
export function isMeasureNote(note) {
  if (!note || Number(note.id) === 0) return false;
  if (note.properties) return note.properties.measure === true;
  return note.measure === true;
}

/**
 * What an object IS, from which variables it has (there is no type field):
 *
 *   'base'            note 0, the BaseNote
 *   'measure'         a bar: start and duration, flagged "measure": true
 *   'note'            frequency, start and duration: the only kind that sounds
 *   'silence'         start and duration
 *   'reference'       a frequency alone: a pitch outside time (a tonic, a key, a
 *                     chord root), drawn as a line across the workspace
 *   'reference-from'  a frequency and a start: a reference that begins (a key
 *                     change), drawn as a line from its start on
 *   'marker'          a start alone
 *   'length'          a duration alone
 *   'name'            none of the three
 *
 * Accepts a Note (asks hasExpression, which is cheap) or a plain JSON note.
 * Only 'note' sounds; references and the rest only relate.
 */
export function noteKind(note) {
  if (!note) return null;
  if (Number(note.id) === 0) return 'base';
  if (isMeasureNote(note)) return 'measure';
  const has = (k) => (typeof note.hasExpression === 'function')
    ? !!note.hasExpression(k)
    : (note[k] != null && String(note[k]).trim() !== '');
  const f = has('frequency'), t = has('startTime'), d = has('duration');
  if (f && t && d) return 'note';
  if (t && d) return 'silence';
  if (f && t) return 'reference-from';
  if (f) return 'reference';
  if (t) return 'marker';
  if (d) return 'length';
  return 'name';
}

/** A note with a frequency and no duration: it relates, it never sounds. */
export function isReferenceNote(note) {
  const k = noteKind(note);
  return k === 'reference' || k === 'reference-from';
}

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

    // Expression storage (BinaryExpression objects). A variable the note does
    // not have holds the shared EMPTY_EXPRESSION; setting it replaces that.
    this.expressions = {
      startTime: EMPTY_EXPRESSION,
      duration: EMPTY_EXPRESSION,
      frequency: EMPTY_EXPRESSION,
      amplitude: EMPTY_EXPRESSION,
      attack: EMPTY_EXPRESSION,
      release: EMPTY_EXPRESSION,
    };

    // Non-expression properties.
    // The base note (id 0) no longer hardcodes 'sine-wave' here: with instrument
    // left null, module.findInstrument() resolves the base note (and every note
    // inheriting from it) to the global default instrument (_defaultInstrumentName,
    // default 'sine-wave' → unchanged behavior), which is what lets the
    // audio.defaultInstrument setting take effect. An explicitly loaded/edited
    // instrument still pins it.
    // `measure` marks a measure bar (see isMeasureNote).
    this.properties = {
      color: null,
      instrument: null,
      measure: false,
    };

    // Bumped whenever an expression changes; the module uses it (together
    // with id and its own graph generation) to skip re-registering unchanged
    // dependency sets in the graph on every markNoteDirty call.
    this._depsEpoch = 0;
    this._depsRegKey = null;
    // The module the stamp above belongs to. Module import migrates note
    // objects out of a temporary module, and the key alone (generation:id:epoch)
    // collides across modules when ids are reused (e.g. a drop after Clean
    // Slate), silently skipping registration in the destination module.
    this._depsRegModule = null;
    // This note's text in the module JSON, kept by Module.createModuleJSONString()
    // with what it was made from (checked on every use, never trusted)
    this._savedJSON = null;

    // Initialize from variables (supports both legacy and new formats)
    this._initFromVariables(variables);
  }

  /**
   * Initialize note from a variables object
   * Handles both legacy format (*String properties, functions) and new format
   */
  _initFromVariables(variables) {
    const expressionVars = EXPRESSION_VARS;

    for (const [key, value] of Object.entries(variables)) {
      // A *String property is the source for its variable. When the plain key is
      // present too, that key's branch below reads it; when it comes ALONE (the
      // add-note form passes only startTimeString, durationString, frequencyString)
      // it is compiled here. Skipping it, as this loop used to, made every note
      // created from the form an empty one.
      if (key.endsWith('String')) {
        const base = key.slice(0, -6);
        if (expressionVars.includes(base) && !(base in variables) && typeof value === 'string' && value.trim() !== '') {
          try {
            this.expressions[base] = compiler.compile(value, base);
          } catch (e) {
            console.warn(`Failed to compile ${base} expression for note ${this.id}:`, e);
          }
        }
        continue;
      }

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
      if (key === 'color' || key === 'instrument' || key === 'repeat') {
        this.properties[key] = value;
      } else if (key === 'measure') {
        this.properties.measure = value === true;
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
    if (name === 'repeat') return this.properties.repeat;
    if (name === 'measure') return this.properties.measure;

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
   * The exact evaluated value of an expression variable (src/value/exact.js):
   * a Fraction when rational, else an Irrational or an Approx. getVariable()
   * returns a Fraction in every case (the nearest double when not rational).
   */
  getExactVariable(name) {
    const shadowValue = this.getVariable(name);
    if (shadowValue == null || !this.module) return shadowValue;
    const cache = this.module.getEvaluationCache();
    const rec = cache && cache.get(this.id);
    const exact = rec && rec.exact && rec.exact[name];
    return exact != null ? exact : shadowValue;
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
    // The BaseNote's repeat: the frequency it takes on the next repeat of a loop,
    // as an expression of the module, kept as text (src/player/display-transpose.js)
    if (name === 'repeat') {
      this.properties.repeat = value || null;
      this._notifyChange();
      return;
    }
    if (name === 'measure') {
      this.properties.measure = value === true;
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
    const expressionVars = EXPRESSION_VARS;
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
        this._depsEpoch++;
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
      this._depsEpoch++;
      this._notifyChange();
    } catch (e) {
      console.warn(`Failed to compile expression for ${name}:`, e);
    }
  }

  /**
   * Internal: Set expression from text WITHOUT triggering change notification.
   * Used by batch operations to avoid per-note overhead.
   * Caller is responsible for marking notes dirty.
   */
  _setExpressionSilent(name, exprText) {
    try {
      this.expressions[name] = compiler.compile(exprText, name);
      this._depsEpoch++;
      this.lastModifiedTime = Date.now();
    } catch (e) {
      console.warn(`Failed to compile expression for ${name}:`, e);
    }
  }

  /**
   * Remove a variable's expression so the note no longer defines it. An
   * inheritable variable then falls back (amplitude: to the BaseNote, then 1),
   * and the key is no longer written to the module JSON.
   * @returns {boolean} whether there was an expression to remove
   */
  clearExpression(name) {
    const expr = this.expressions[name];
    if (!expr || expr.isEmpty()) return false;
    this.expressions[name] = EMPTY_EXPRESSION;
    this._depsEpoch++;
    this.lastModifiedTime = Date.now();
    this._notifyChange();
    return true;
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
    const expressionVars = EXPRESSION_VARS;
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
    if (this.properties.repeat) result.repeat = this.properties.repeat;
    if (this.properties.measure) result.measure = true;

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
    if (this.properties.repeat) obj.repeat = this.properties.repeat;
    if (this.properties.measure) obj.measure = true;

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
   * Returns a proxy that maps to the new structure. The proxy (and the
   * per-variable function wrappers) are created once per note and cached —
   * this getter is on hot paths (renderer sync, drag commit, retargeting)
   * and used to allocate a fresh Proxy on every single access.
   */
  get variables() {
    if (this._variablesProxy) {
      return this._variablesProxy;
    }
    const note = this;
    const fnCache = new Map();
    this._variablesProxy = new Proxy({}, {
      get(target, prop) {
        // Handle *String properties
        if (typeof prop === 'string' && prop.endsWith('String')) {
          const baseName = prop.slice(0, -6);
          return note.getExpressionSource(baseName);
        }
        // Handle expression variables - return a function wrapper for legacy code
        // Only return a function if the expression actually exists
        const expressionVars = EXPRESSION_VARS;
        if (expressionVars.includes(prop)) {
          // Check if this expression actually exists
          if (!note.hasExpression(prop)) {
            return undefined;
          }
          // Create a function that includes the variable name directly in its source
          // This is important because legacy code may call .toString() on the function
          // and try to extract the expression from it
          const varName = prop;
          let fn = fnCache.get(varName);
          if (!fn) {
            fn = function() {
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
            fnCache.set(varName, fn);
          }
          return fn;
        }
        // Handle properties
        if (prop === 'color') return note.properties.color;
        if (prop === 'instrument') return note.properties.instrument;
        if (prop === 'measure') return note.properties.measure || undefined;
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
        if (prop === 'measure') return note.properties.measure === true;
        if (typeof prop === 'string' && prop.endsWith('String')) {
          const baseName = prop.slice(0, -6);
          return note.hasExpression(baseName);
        }
        const expressionVars = EXPRESSION_VARS;
        if (expressionVars.includes(prop)) {
          return note.hasExpression(prop);
        }
        return false;
      },
      ownKeys(target) {
        const keys = [];
        const expressionVars = EXPRESSION_VARS;
        for (const name of expressionVars) {
          if (note.hasExpression(name)) {
            keys.push(name);
            keys.push(name + 'String');
          }
        }
        if (note.properties.color) keys.push('color');
        if (note.properties.instrument) keys.push('instrument');
        if (note.properties.measure) keys.push('measure');
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
    return this._variablesProxy;
  }
}
