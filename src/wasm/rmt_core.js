/* @ts-self-types="./rmt_core.d.ts" */

/**
 * Dependency graph with bidirectional indexing
 */
export class DependencyGraph {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        DependencyGraphFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_dependencygraph_free(ptr, 0);
    }
    /**
     * Add or update dependencies for a note from JavaScript
     * @param {number} note_id
     * @param {Uint32Array} deps
     * @param {boolean} references_base
     */
    addNote(note_id, deps, references_base) {
        const ptr0 = passArray32ToWasm0(deps, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.dependencygraph_addNote(this.__wbg_ptr, note_id, ptr0, len0, references_base);
    }
    /**
     * Clear the entire graph
     */
    clear() {
        wasm.dependencygraph_clear(this.__wbg_ptr);
    }
    /**
     * Detect cycles and return them as a serialized value
     * @returns {any}
     */
    detectCycles() {
        const ret = wasm.dependencygraph_detectCycles(this.__wbg_ptr);
        return ret;
    }
    /**
     * Get all transitive dependencies as an array
     * @param {number} note_id
     * @returns {Uint32Array}
     */
    getAllDependencies(note_id) {
        const ret = wasm.dependencygraph_getAllDependencies(this.__wbg_ptr, note_id);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Get all transitive dependents as an array
     * @param {number} note_id
     * @returns {Uint32Array}
     */
    getAllDependents(note_id) {
        const ret = wasm.dependencygraph_getAllDependents(this.__wbg_ptr, note_id);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Get base note dependents as an array
     * @returns {Uint32Array}
     */
    getBaseNoteDependents() {
        const ret = wasm.dependencygraph_getBaseNoteDependents(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Get direct dependencies as an array
     * @param {number} note_id
     * @returns {Uint32Array}
     */
    getDependencies(note_id) {
        const ret = wasm.dependencygraph_getDependencies(this.__wbg_ptr, note_id);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Get direct dependents as an array
     * @param {number} note_id
     * @returns {Uint32Array}
     */
    getDependents(note_id) {
        const ret = wasm.dependencygraph_getDependents(this.__wbg_ptr, note_id);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Get evaluation order for given note IDs
     * @param {Uint32Array} note_ids
     * @returns {Uint32Array}
     */
    getEvaluationOrder(note_ids) {
        const ptr0 = passArray32ToWasm0(note_ids, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.dependencygraph_getEvaluationOrder(this.__wbg_ptr, ptr0, len0);
        var v2 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
    /**
     * Get graph statistics as a JavaScript object
     * @returns {any}
     */
    getStats() {
        const ret = wasm.dependencygraph_getStats(this.__wbg_ptr);
        return ret;
    }
    /**
     * Check if there's a dependency path between two notes
     * @param {number} source
     * @param {number} target
     * @returns {boolean}
     */
    hasDependencyPath(source, target) {
        const ret = wasm.dependencygraph_hasDependencyPath(this.__wbg_ptr, source, target);
        return ret !== 0;
    }
    /**
     * Check if a note exists in the graph
     * @param {number} note_id
     * @returns {boolean}
     */
    hasNote(note_id) {
        const ret = wasm.dependencygraph_hasNote(this.__wbg_ptr, note_id);
        return ret !== 0;
    }
    /**
     * Create a new empty dependency graph
     */
    constructor() {
        const ret = wasm.dependencygraph_new();
        this.__wbg_ptr = ret >>> 0;
        DependencyGraphFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Get the number of notes in the graph
     * @returns {number}
     */
    get noteCount() {
        const ret = wasm.dependencygraph_noteCount(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Remove a note from JavaScript
     * @param {number} note_id
     */
    removeNote(note_id) {
        wasm.dependencygraph_removeNote(this.__wbg_ptr, note_id);
    }
    /**
     * Bulk sync from JavaScript data
     * @param {any} data
     */
    syncFromJs(data) {
        const ret = wasm.dependencygraph_syncFromJs(this.__wbg_ptr, data);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
}
if (Symbol.dispose) DependencyGraph.prototype[Symbol.dispose] = DependencyGraph.prototype.free;

/**
 * Stack-based evaluator for binary expressions
 *
 * Now supports both rational (Fraction) and irrational (f64) values via the Value type.
 * Operations like Pow may produce irrational results.
 */
export class Evaluator {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        EvaluatorFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_evaluator_free(ptr, 0);
    }
    /**
     * Evaluate a single expression from JavaScript
     *
     * # Arguments
     * * `bytecode` - Uint8Array of bytecode
     * * `length` - Number of valid bytes
     * * `eval_cache` - JavaScript object mapping noteId to evaluated values
     *
     * # Returns
     * Object with { s, n, d } representing the fraction
     * @param {Uint8Array} bytecode
     * @param {number} length
     * @param {any} eval_cache
     * @returns {any}
     */
    evaluateExpression(bytecode, length, eval_cache) {
        const ptr0 = passArray8ToWasm0(bytecode, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.evaluator_evaluateExpression(this.__wbg_ptr, ptr0, len0, length, eval_cache);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Evaluate all expressions for a note from JavaScript
     *
     * # Arguments
     * * `expressions` - Object with expression bytecodes for each variable
     * * `eval_cache` - JavaScript object mapping noteId to evaluated values
     *
     * # Returns
     * Object with evaluated values for each variable
     * @param {any} expressions
     * @param {any} eval_cache
     * @returns {any}
     */
    evaluateNote(expressions, eval_cache) {
        const ret = wasm.evaluator_evaluateNote(this.__wbg_ptr, expressions, eval_cache);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Create a new evaluator
     */
    constructor() {
        const ret = wasm.evaluator_new();
        this.__wbg_ptr = ret >>> 0;
        EvaluatorFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Get current stack size (for debugging)
     * @returns {number}
     */
    get stackSize() {
        const ret = wasm.evaluator_stackSize(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) Evaluator.prototype[Symbol.dispose] = Evaluator.prototype.free;

/**
 * Expression compiler
 */
export class ExpressionCompiler {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ExpressionCompilerFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_expressioncompiler_free(ptr, 0);
    }
    /**
     * Compile a text expression to binary bytecode from JavaScript
     * @param {string} text_expr
     * @returns {any}
     */
    compile(text_expr) {
        const ptr0 = passStringToWasm0(text_expr, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.expressioncompiler_compile(this.__wbg_ptr, ptr0, len0);
        return ret;
    }
    /**
     * Create a new compiler
     */
    constructor() {
        const ret = wasm.expressioncompiler_new();
        this.__wbg_ptr = ret >>> 0;
        ExpressionCompilerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) ExpressionCompiler.prototype[Symbol.dispose] = ExpressionCompiler.prototype.free;

/**
 * Arbitrary-precision rational number
 *
 * Wraps num-rational's BigRational to provide a JavaScript-compatible API.
 */
export class Fraction {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(Fraction.prototype);
        obj.__wbg_ptr = ptr;
        FractionFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        FractionFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_fraction_free(ptr, 0);
    }
    /**
     * Get the absolute value
     * @returns {Fraction}
     */
    abs() {
        const ret = wasm.fraction_abs(this.__wbg_ptr);
        return Fraction.__wrap(ret);
    }
    /**
     * Add two fractions
     * @param {Fraction} other
     * @returns {Fraction}
     */
    add(other) {
        _assertClass(other, Fraction);
        const ret = wasm.fraction_add(this.__wbg_ptr, other.__wbg_ptr);
        return Fraction.__wrap(ret);
    }
    /**
     * Clone this fraction
     * @returns {Fraction}
     */
    clone() {
        const ret = wasm.fraction_clone(this.__wbg_ptr);
        return Fraction.__wrap(ret);
    }
    /**
     * Compare this fraction to another
     * Returns -1 if self < other, 0 if equal, 1 if self > other
     * @param {Fraction} other
     * @returns {number}
     */
    compare(other) {
        _assertClass(other, Fraction);
        const ret = wasm.fraction_compare(this.__wbg_ptr, other.__wbg_ptr);
        return ret;
    }
    /**
     * Get the denominator
     * @returns {number}
     */
    get d() {
        const ret = wasm.fraction_d(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get the denominator as a string (for large values)
     * @returns {string}
     */
    denominatorStr() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.fraction_denominatorStr(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Divide two fractions
     * @param {Fraction} other
     * @returns {Fraction}
     */
    div(other) {
        _assertClass(other, Fraction);
        const ret = wasm.fraction_div(this.__wbg_ptr, other.__wbg_ptr);
        return Fraction.__wrap(ret);
    }
    /**
     * Check if this fraction equals another
     * @param {Fraction} other
     * @returns {boolean}
     */
    equals(other) {
        _assertClass(other, Fraction);
        const ret = wasm.fraction_equals(this.__wbg_ptr, other.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Create a Fraction from a floating-point number
     * @param {number} value
     * @returns {Fraction}
     */
    static fromF64(value) {
        const ret = wasm.fraction_fromF64(value);
        return Fraction.__wrap(ret);
    }
    /**
     * Create a Fraction from a single integer
     * @param {number} n
     * @returns {Fraction}
     */
    static fromInt(n) {
        const ret = wasm.fraction_fromInt(n);
        return Fraction.__wrap(ret);
    }
    /**
     * Create a Fraction from a string like "3/4" or "1.5"
     * @param {string} s
     * @returns {Fraction}
     */
    static fromString(s) {
        const ptr0 = passStringToWasm0(s, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.fraction_fromString(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Fraction.__wrap(ret[0]);
    }
    /**
     * Get the reciprocal (1/x)
     * @returns {Fraction}
     */
    inverse() {
        const ret = wasm.fraction_inverse(this.__wbg_ptr);
        return Fraction.__wrap(ret);
    }
    /**
     * Check if this is negative
     * @returns {boolean}
     */
    isNegative() {
        const ret = wasm.fraction_isNegative(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Check if this is one
     * @returns {boolean}
     */
    isOne() {
        const ret = wasm.fraction_isOne(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Check if this is positive
     * @returns {boolean}
     */
    isPositive() {
        const ret = wasm.fraction_isPositive(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Check if this is zero
     * @returns {boolean}
     */
    isZero() {
        const ret = wasm.fraction_isZero(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Multiply two fractions
     * @param {Fraction} other
     * @returns {Fraction}
     */
    mul(other) {
        _assertClass(other, Fraction);
        const ret = wasm.fraction_mul(this.__wbg_ptr, other.__wbg_ptr);
        return Fraction.__wrap(ret);
    }
    /**
     * Get the absolute numerator
     * @returns {number}
     */
    get n() {
        const ret = wasm.fraction_n(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Negate the fraction
     * @returns {Fraction}
     */
    neg() {
        const ret = wasm.fraction_neg(this.__wbg_ptr);
        return Fraction.__wrap(ret);
    }
    /**
     * Create a new Fraction from numerator and denominator
     * @param {number} num
     * @param {number} den
     */
    constructor(num, den) {
        const ret = wasm.fraction_new(num, den);
        this.__wbg_ptr = ret >>> 0;
        FractionFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Get the numerator as a string (for large values)
     * @returns {string}
     */
    numeratorStr() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.fraction_numeratorStr(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Get the sign (-1, 0, or 1)
     * @returns {number}
     */
    get s() {
        const ret = wasm.fraction_s(this.__wbg_ptr);
        return ret;
    }
    /**
     * Subtract two fractions
     * @param {Fraction} other
     * @returns {Fraction}
     */
    sub(other) {
        _assertClass(other, Fraction);
        const ret = wasm.fraction_sub(this.__wbg_ptr, other.__wbg_ptr);
        return Fraction.__wrap(ret);
    }
    /**
     * Convert to f64
     * @returns {number}
     */
    toF64() {
        const ret = wasm.fraction_toF64(this.__wbg_ptr);
        return ret;
    }
    /**
     * Convert to string representation "n/d" or "n" if d=1
     * @returns {string}
     */
    toString() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.fraction_toString(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) Fraction.prototype[Symbol.dispose] = Fraction.prototype.free;

/**
 * Persistent evaluator with WASM-resident cache
 *
 * This evaluator keeps the evaluation cache in WASM memory to avoid
 * O(N²) serialization overhead when evaluating large modules.
 * Now supports both rational (Fraction) and irrational (f64) values via the Value type.
 */
export class PersistentEvaluator {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        PersistentEvaluatorFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_persistentevaluator_free(ptr, 0);
    }
    /**
     * Get cache size
     * @returns {number}
     */
    get cacheSize() {
        const ret = wasm.persistentevaluator_cacheSize(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Clear all dirty flags
     */
    clearDirty() {
        wasm.persistentevaluator_clearDirty(this.__wbg_ptr);
    }
    /**
     * Evaluate all dirty notes in topological order
     * Returns the number of notes evaluated
     * @param {Uint32Array} sorted_ids
     * @returns {number}
     */
    evaluateDirty(sorted_ids) {
        const ptr0 = passArray32ToWasm0(sorted_ids, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.persistentevaluator_evaluateDirty(this.__wbg_ptr, ptr0, len0);
        return ret >>> 0;
    }
    /**
     * Evaluate a single note using internal cache
     * Tracks corruption flags for each property
     * @param {number} note_id
     * @returns {boolean}
     */
    evaluateNoteInternal(note_id) {
        const ret = wasm.persistentevaluator_evaluateNoteInternal(this.__wbg_ptr, note_id);
        return ret !== 0;
    }
    /**
     * Export entire cache (for persistence/debug)
     * @returns {any}
     */
    exportCache() {
        const ret = wasm.persistentevaluator_exportCache(this.__wbg_ptr);
        return ret;
    }
    /**
     * Get generation counter
     * @returns {bigint}
     */
    get generation() {
        const ret = wasm.persistentevaluator_generation(this.__wbg_ptr);
        return BigInt.asUintN(64, ret);
    }
    /**
     * Get all cached values for a note
     * @param {number} note_id
     * @returns {any}
     */
    getCachedNote(note_id) {
        const ret = wasm.persistentevaluator_getCachedNote(this.__wbg_ptr, note_id);
        return ret;
    }
    /**
     * Get a single cached value
     * @param {number} note_id
     * @param {number} var_index
     * @returns {any}
     */
    getCachedValue(note_id, var_index) {
        const ret = wasm.persistentevaluator_getCachedValue(this.__wbg_ptr, note_id, var_index);
        return ret;
    }
    /**
     * Check if a note is in the cache
     * @param {number} note_id
     * @returns {boolean}
     */
    hasCachedNote(note_id) {
        const ret = wasm.persistentevaluator_hasCachedNote(this.__wbg_ptr, note_id);
        return ret !== 0;
    }
    /**
     * Import cache from JSON (for undo/redo snapshots)
     * @param {any} cache_json
     */
    importCache(cache_json) {
        const ret = wasm.persistentevaluator_importCache(this.__wbg_ptr, cache_json);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Clear the entire cache
     */
    invalidateAll() {
        wasm.persistentevaluator_invalidateAll(this.__wbg_ptr);
    }
    /**
     * Invalidate a single note from the cache
     * @param {number} note_id
     */
    invalidateNote(note_id) {
        wasm.persistentevaluator_invalidateNote(this.__wbg_ptr, note_id);
    }
    /**
     * Mark a note as dirty (needs re-evaluation)
     * @param {number} note_id
     */
    markDirty(note_id) {
        wasm.persistentevaluator_markDirty(this.__wbg_ptr, note_id);
    }
    /**
     * Mark multiple notes as dirty
     * @param {Uint32Array} note_ids
     */
    markDirtyBatch(note_ids) {
        const ptr0 = passArray32ToWasm0(note_ids, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.persistentevaluator_markDirtyBatch(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Create a new persistent evaluator
     */
    constructor() {
        const ret = wasm.persistentevaluator_new();
        this.__wbg_ptr = ret >>> 0;
        PersistentEvaluatorFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Register bytecode for a single expression
     * @param {number} note_id
     * @param {number} var_index
     * @param {Uint8Array} bytecode
     * @param {number} length
     */
    registerExpression(note_id, var_index, bytecode, length) {
        const ptr0 = passArray8ToWasm0(bytecode, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.persistentevaluator_registerExpression(this.__wbg_ptr, note_id, var_index, ptr0, len0, length);
    }
    /**
     * Register all expressions for a note at once
     * @param {number} note_id
     * @param {any} expressions
     */
    registerNote(note_id, expressions) {
        const ret = wasm.persistentevaluator_registerNote(this.__wbg_ptr, note_id, expressions);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Remove a note completely (when deleted from module)
     * @param {number} note_id
     */
    removeNote(note_id) {
        wasm.persistentevaluator_removeNote(this.__wbg_ptr, note_id);
    }
}
if (Symbol.dispose) PersistentEvaluator.prototype[Symbol.dispose] = PersistentEvaluator.prototype.free;

/**
 * Initialize the WASM module
 * Call this once when loading the module to set up panic hooks
 */
export function init() {
    wasm.init();
}

/**
 * Get the version of the rmt-core library
 * @returns {string}
 */
export function version() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.version();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_8c4e43fe74559d73: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_Number_04624de7d0e8332d: function(arg0) {
            const ret = Number(arg0);
            return ret;
        },
        __wbg_String_8f0eb39a4a4c2f66: function(arg0, arg1) {
            const ret = String(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_bigint_get_as_i64_8fcf4ce7f1ca72a2: function(arg0, arg1) {
            const v = arg1;
            const ret = typeof(v) === 'bigint' ? v : undefined;
            getDataViewMemory0().setBigInt64(arg0 + 8 * 1, isLikeNone(ret) ? BigInt(0) : ret, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
        },
        __wbg___wbindgen_boolean_get_bbbb1c18aa2f5e25: function(arg0) {
            const v = arg0;
            const ret = typeof(v) === 'boolean' ? v : undefined;
            return isLikeNone(ret) ? 0xFFFFFF : ret ? 1 : 0;
        },
        __wbg___wbindgen_debug_string_0bc8482c6e3508ae: function(arg0, arg1) {
            const ret = debugString(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_in_47fa6863be6f2f25: function(arg0, arg1) {
            const ret = arg0 in arg1;
            return ret;
        },
        __wbg___wbindgen_is_bigint_31b12575b56f32fc: function(arg0) {
            const ret = typeof(arg0) === 'bigint';
            return ret;
        },
        __wbg___wbindgen_is_function_0095a73b8b156f76: function(arg0) {
            const ret = typeof(arg0) === 'function';
            return ret;
        },
        __wbg___wbindgen_is_object_5ae8e5880f2c1fbd: function(arg0) {
            const val = arg0;
            const ret = typeof(val) === 'object' && val !== null;
            return ret;
        },
        __wbg___wbindgen_is_string_cd444516edc5b180: function(arg0) {
            const ret = typeof(arg0) === 'string';
            return ret;
        },
        __wbg___wbindgen_is_undefined_9e4d92534c42d778: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_jsval_eq_11888390b0186270: function(arg0, arg1) {
            const ret = arg0 === arg1;
            return ret;
        },
        __wbg___wbindgen_jsval_loose_eq_9dd77d8cd6671811: function(arg0, arg1) {
            const ret = arg0 == arg1;
            return ret;
        },
        __wbg___wbindgen_number_get_8ff4255516ccad3e: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'number' ? obj : undefined;
            getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
        },
        __wbg___wbindgen_string_get_72fb696202c56729: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_be289d5034ed271b: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_call_389efe28435a9388: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.call(arg1);
            return ret;
        }, arguments); },
        __wbg_done_57b39ecd9addfe81: function(arg0) {
            const ret = arg0.done;
            return ret;
        },
        __wbg_entries_58c7934c745daac7: function(arg0) {
            const ret = Object.entries(arg0);
            return ret;
        },
        __wbg_error_7534b8e9a36f1ab4: function(arg0, arg1) {
            let deferred0_0;
            let deferred0_1;
            try {
                deferred0_0 = arg0;
                deferred0_1 = arg1;
                console.error(getStringFromWasm0(arg0, arg1));
            } finally {
                wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
            }
        },
        __wbg_get_9b94d73e6221f75c: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        },
        __wbg_get_b3ed3ad4be2bc8ac: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.get(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_get_with_ref_key_1dc361bd10053bfe: function(arg0, arg1) {
            const ret = arg0[arg1];
            return ret;
        },
        __wbg_instanceof_ArrayBuffer_c367199e2fa2aa04: function(arg0) {
            let result;
            try {
                result = arg0 instanceof ArrayBuffer;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Uint8Array_9b9075935c74707c: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Uint8Array;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_isArray_d314bb98fcf08331: function(arg0) {
            const ret = Array.isArray(arg0);
            return ret;
        },
        __wbg_isSafeInteger_bfbc7332a9768d2a: function(arg0) {
            const ret = Number.isSafeInteger(arg0);
            return ret;
        },
        __wbg_iterator_6ff6560ca1568e55: function() {
            const ret = Symbol.iterator;
            return ret;
        },
        __wbg_length_32ed9a279acd054c: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_length_35a7bace40f36eac: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_new_361308b2356cecd0: function() {
            const ret = new Object();
            return ret;
        },
        __wbg_new_3eb36ae241fe6f44: function() {
            const ret = new Array();
            return ret;
        },
        __wbg_new_8a6f238a6ece86ea: function() {
            const ret = new Error();
            return ret;
        },
        __wbg_new_dca287b076112a51: function() {
            const ret = new Map();
            return ret;
        },
        __wbg_new_dd2b680c8bf6ae29: function(arg0) {
            const ret = new Uint8Array(arg0);
            return ret;
        },
        __wbg_next_3482f54c49e8af19: function() { return handleError(function (arg0) {
            const ret = arg0.next();
            return ret;
        }, arguments); },
        __wbg_next_418f80d8f5303233: function(arg0) {
            const ret = arg0.next;
            return ret;
        },
        __wbg_prototypesetcall_bdcdcc5842e4d77d: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
        },
        __wbg_set_1eb0999cf5d27fc8: function(arg0, arg1, arg2) {
            const ret = arg0.set(arg1, arg2);
            return ret;
        },
        __wbg_set_3f1d0b984ed272ed: function(arg0, arg1, arg2) {
            arg0[arg1] = arg2;
        },
        __wbg_set_f43e577aea94465b: function(arg0, arg1, arg2) {
            arg0[arg1 >>> 0] = arg2;
        },
        __wbg_stack_0ed75d68575b0f3c: function(arg0, arg1) {
            const ret = arg1.stack;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_value_0546255b415e96c1: function(arg0) {
            const ret = arg0.value;
            return ret;
        },
        __wbindgen_cast_0000000000000001: function(arg0) {
            // Cast intrinsic for `F64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_cast_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_cast_0000000000000003: function(arg0) {
            // Cast intrinsic for `U64 -> Externref`.
            const ret = BigInt.asUintN(64, arg0);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./rmt_core_bg.js": import0,
    };
}

const DependencyGraphFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_dependencygraph_free(ptr >>> 0, 1));
const EvaluatorFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_evaluator_free(ptr >>> 0, 1));
const ExpressionCompilerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_expressioncompiler_free(ptr >>> 0, 1));
const FractionFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_fraction_free(ptr >>> 0, 1));
const PersistentEvaluatorFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_persistentevaluator_free(ptr >>> 0, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}

function debugString(val) {
    // primitive types
    const type = typeof val;
    if (type == 'number' || type == 'boolean' || val == null) {
        return  `${val}`;
    }
    if (type == 'string') {
        return `"${val}"`;
    }
    if (type == 'symbol') {
        const description = val.description;
        if (description == null) {
            return 'Symbol';
        } else {
            return `Symbol(${description})`;
        }
    }
    if (type == 'function') {
        const name = val.name;
        if (typeof name == 'string' && name.length > 0) {
            return `Function(${name})`;
        } else {
            return 'Function';
        }
    }
    // objects
    if (Array.isArray(val)) {
        const length = val.length;
        let debug = '[';
        if (length > 0) {
            debug += debugString(val[0]);
        }
        for(let i = 1; i < length; i++) {
            debug += ', ' + debugString(val[i]);
        }
        debug += ']';
        return debug;
    }
    // Test for built-in
    const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
    let className;
    if (builtInMatches && builtInMatches.length > 1) {
        className = builtInMatches[1];
    } else {
        // Failed to match the standard '[object ClassName]'
        return toString.call(val);
    }
    if (className == 'Object') {
        // we're a user defined class or Object
        // JSON.stringify avoids problems with cycles, and is generally much
        // easier than looping through ownProperties of `val`.
        try {
            return 'Object(' + JSON.stringify(val) + ')';
        } catch (_) {
            return 'Object';
        }
    }
    // errors
    if (val instanceof Error) {
        return `${val.name}: ${val.message}\n${val.stack}`;
    }
    // TODO we could test for more things here, like `Set`s and `Map`s.
    return className;
}

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasm;
function __wbg_finalize_init(instance, module) {
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('rmt_core_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
