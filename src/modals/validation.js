import Fraction from 'fraction.js';
import { isDSLSyntax, validateDSL, compileDSL } from '../dsl/index.js';
import { ExpressionCompiler } from '../expression-compiler.js';
import { BinaryEvaluator } from '../binary-evaluator.js';
import { validateExpressionSyntax } from '../utils/safe-expression-validator.js';
import { findDependencyCycle } from '../variable-deps.js';
import { EXPRESSION_VARS } from '../note.js';

// Singleton compiler for safe validation
const safeCompiler = new ExpressionCompiler();

export function validateExpression(moduleInstance, noteId, expression, variableType) {
    const expr = String(expression ?? '').trim();
    if (!expr) {
        throw new Error('Expression cannot be empty or undefined');
    }

    // Check if this is DSL syntax
    const isDSL = isDSLSyntax(expr);

    if (isDSL) {
        // DSL validation path
        return validateDSLExpression(moduleInstance, noteId, expr, variableType);
    }

    // Legacy validation path
    return validateLegacyExpression(moduleInstance, noteId, expr, variableType);
}

/**
 * Refuse an expression that would make a variable depend on itself.
 *
 * The check is per (note, variable), like evaluation: a note may read another
 * variable of its own, and two notes may read each other, as long as no
 * variable ends up reading itself. `[5].d * 2` as note 5's startTime is fine;
 * `[5].t + 1` as note 5's startTime is not.
 */
function assertNoDependencyCycle(moduleInstance, noteId, variableType, binary) {
    const cycle = findDependencyCycle(moduleInstance, noteId, variableType, binary);
    if (!cycle) return;
    if (cycle.length === 1) {
        throw new Error('Expression cannot reference itself directly');
    }
    throw new Error('Circular dependency detected in expression');
}

/**
 * Validate DSL expression
 */
function validateDSLExpression(moduleInstance, noteId, expr, variableType) {
    // Validate DSL syntax
    const validation = validateDSL(expr);
    if (!validation.valid) {
        throw new Error(`Invalid DSL expression: ${validation.error}`);
    }

    // Compile to verify it produces valid bytecode
    let binary;
    try {
        binary = compileDSL(expr);
    } catch (e) {
        throw new Error(`Invalid DSL expression: ${e.message}`);
    }

    // Check for self-reference and circular dependencies, on what it compiled to
    assertNoDependencyCycle(moduleInstance, noteId, variableType, binary);

    // Successfully compiled - return the original DSL expression
    return expr;
}

/**
 * Validate legacy (JavaScript-style) expression
 *
 * SECURITY: This function DOES NOT use eval() or new Function().
 * It validates expressions using safe pattern-based parsing and binary compilation.
 */
function validateLegacyExpression(moduleInstance, noteId, expr, variableType) {
    let openParens = 0;
    for (const char of expr) {
        if (char === '(') openParens++;
        else if (char === ')') openParens--;
        if (openParens < 0) {
            throw new Error('Unbalanced parentheses: too many closing parentheses');
        }
    }
    if (openParens > 0) {
        throw new Error('Unbalanced parentheses: missing closing parentheses');
    }

    // Validate expression syntax using safe validator (checks for dangerous patterns)
    const syntaxValidation = validateExpressionSyntax(expr);
    if (!syntaxValidation.valid) {
        throw new Error(syntaxValidation.error);
    }

    // Check for self-reference and circular dependencies, on what it compiles to
    // (the syntax check above already proved that it compiles)
    assertNoDependencyCycle(moduleInstance, noteId, variableType, safeCompiler.compile(expr));

    // Detect whether expression contains references; if so, we preserve user-authored structure
    const hasRefs =
        /\.getVariable\s*\(/.test(expr) ||
        /module\.(?:baseNote|getNoteById)\s*\(/.test(expr) ||
        /module\.baseNote/.test(expr);

    try {
        // Compile expression to binary using safe regex-based parser
        // This will throw if the expression doesn't match valid patterns
        const binary = safeCompiler.compile(expr);

        // Evaluate using safe binary evaluator
        const evaluator = new BinaryEvaluator(moduleInstance);
        const evalCache = buildEvalCacheForValidation(moduleInstance);
        const result = evaluator.evaluate(binary, evalCache);

        if (result === undefined || result === null) {
            throw new Error('Expression resulted in undefined or null');
        }

        // Convert result to Fraction for validation
        let fracResult;
        if (result instanceof Fraction) {
            fracResult = result;
        } else if (typeof result === 'number') {
            fracResult = new Fraction(result);
        } else if (typeof result.toFraction === 'function') {
            // MusicValue-style wrapper: toFraction() is exact (Fraction or 'n/d' string)
            const exact = result.toFraction();
            fracResult = exact instanceof Fraction ? exact : new Fraction(exact);
        } else {
            throw new Error('Expression must result in a Fraction or a number');
        }

        if (hasRefs) {
            // Keep dependency-carrying expressions intact
            return expr;
        }

        // Numeric-only expression: canonicalize to reduced Fraction literal
        return `new Fraction(${fracResult.s * fracResult.n}, ${fracResult.d})`;
    } catch (e) {
        console.error(`Error in expression validation for Note ${noteId}:`, e);
        throw new Error(`Invalid expression: ${e.message}`);
    }
}

/**
 * Build evaluation cache for validation purposes
 */
function buildEvalCacheForValidation(moduleInstance) {
    const cache = new Map();
    if (!moduleInstance) return cache;

    const record = (note) => {
        const rec = {};
        for (const v of EXPRESSION_VARS) {
            rec[v] = note.getVariable ? note.getVariable(v) : null;
        }
        return rec;
    };

    // Cache baseNote as ID 0
    const baseNote = moduleInstance.baseNote;
    if (baseNote) {
        try {
            cache.set(0, record(baseNote));
        } catch (e) { /* ignore */ }
    }

    // Cache all notes
    if (moduleInstance.notes) {
        for (const id in moduleInstance.notes) {
            const noteId = parseInt(id, 10);
            if (isNaN(noteId) || cache.has(noteId)) continue;

            const note = moduleInstance.notes[id];
            if (!note) continue;

            try {
                cache.set(noteId, record(note));
            } catch (e) { /* ignore individual note errors */ }
        }
    }

    return cache;
}

/**
 * Whether saving `expression` as this variable would make a variable depend
 * on itself (a direct self-reference counts).
 */
export function detectCircularDependency(moduleInstance, noteId, expression, variableType) {
    const expr = String(expression ?? '').trim();
    let binary;
    try {
        binary = isDSLSyntax(expr) ? compileDSL(expr) : safeCompiler.compile(expr);
    } catch (e) {
        return false; // does not compile: there is nothing to depend on
    }
    return findDependencyCycle(moduleInstance, noteId, variableType, binary) !== null;
}

/**
 * Kept for callers that still announce module changes. The cycle check reads
 * the notes' compiled expressions directly, so there is no cache to drop.
 */
export function invalidateDependencyGraphCache() {
}