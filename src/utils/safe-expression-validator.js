/**
 * Safe Expression Validator and Evaluator
 *
 * This module provides safe validation and evaluation of expressions WITHOUT
 * using eval() or new Function(). Instead, it leverages the existing safe
 * compilation pipeline:
 *
 * 1. DSL expressions (e.g., "[1].f * (3/2)") → compileDSL() → BinaryExpression
 * 2. Legacy expressions (e.g., "new Fraction(...)") → ExpressionCompiler → BinaryExpression
 * 3. BinaryExpression → BinaryEvaluator → Safe evaluation
 *
 * This prevents arbitrary code execution from malicious module.json files.
 */

import Fraction from 'fraction.js';
import { ExpressionCompiler } from '../expression-compiler.js';
import { BinaryEvaluator } from '../binary-evaluator.js';
import { isDSLSyntax, compileDSL } from '../dsl/index.js';

// Singleton compiler instance
const safeCompiler = new ExpressionCompiler();

/**
 * Validate that an expression string is safe to use.
 * Does NOT execute the expression, only validates its structure.
 *
 * @param {string} expr - The expression to validate
 * @returns {{valid: boolean, error?: string}} - Validation result
 */
export function validateExpressionSyntax(expr) {
    if (expr == null) {
        return { valid: false, error: 'Expression cannot be null or undefined' };
    }

    const exprStr = String(expr).trim();
    if (!exprStr) {
        return { valid: false, error: 'Expression cannot be empty' };
    }

    // Check for maximum length to prevent DoS
    if (exprStr.length > 10000) {
        return { valid: false, error: 'Expression too long (max 10000 characters)' };
    }

    // Check for obviously dangerous patterns (defense in depth)
    const dangerousPatterns = [
        /\beval\s*\(/i,
        /\bFunction\s*\(/i,
        /\bsetTimeout\s*\(/i,
        /\bsetInterval\s*\(/i,
        /\bimport\s*\(/i,
        /\brequire\s*\(/i,
        /\bfetch\s*\(/i,
        /\bXMLHttpRequest/i,
        /\bdocument\./i,
        /\bwindow\./i,
        /\bglobalThis\./i,
        /\bprocess\./i,
        /\b__proto__\b/,
        /\bconstructor\s*\[/,
        /\bprototype\b/,
        /<script/i,
        /javascript:/i,
        /on\w+\s*=/i,  // Event handlers like onclick=
    ];

    for (const pattern of dangerousPatterns) {
        if (pattern.test(exprStr)) {
            return { valid: false, error: 'Expression contains forbidden pattern' };
        }
    }

    // Try to compile the expression using the safe compiler
    // If it fails to parse with our strict parser, it's invalid
    try {
        if (isDSLSyntax(exprStr)) {
            // DSL syntax is inherently safe - it compiles to bytecode
            compileDSL(exprStr);
        } else {
            // Legacy syntax - use our strict regex-based parser
            safeCompiler.compile(exprStr);
        }
        return { valid: true };
    } catch (e) {
        return { valid: false, error: `Invalid expression: ${e.message}` };
    }
}

/**
 * Safely evaluate an expression using binary compilation.
 * This NEVER uses eval() or new Function().
 *
 * @param {string} expr - The expression to evaluate
 * @param {Object} moduleInstance - The module instance for lookups
 * @param {Map} [evalCache] - Optional pre-built evaluation cache
 * @returns {Fraction|null} - The evaluated result, or null if evaluation fails
 */
export function evaluateExpressionSafe(expr, moduleInstance, evalCache = null) {
    if (!moduleInstance) {
        console.warn('evaluateExpressionSafe: No module instance provided');
        return null;
    }

    const exprStr = String(expr).trim();
    if (!exprStr) {
        return new Fraction(0);
    }

    // Validate first
    const validation = validateExpressionSyntax(exprStr);
    if (!validation.valid) {
        console.warn('evaluateExpressionSafe: Invalid expression:', validation.error);
        return null;
    }

    try {
        // Compile to binary
        let binary;
        if (isDSLSyntax(exprStr)) {
            binary = compileDSL(exprStr);
        } else {
            binary = safeCompiler.compile(exprStr);
        }

        // Build evaluation cache if not provided
        const cache = evalCache || buildEvaluationCache(moduleInstance);

        // Evaluate using the safe binary evaluator
        const evaluator = new BinaryEvaluator(moduleInstance);
        const result = evaluator.evaluate(binary, cache);

        // Convert result to Fraction
        if (result == null) {
            return null;
        }
        if (result instanceof Fraction) {
            return result;
        }
        if (typeof result.toFraction === 'function') {
            return result.toFraction();
        }
        if (typeof result.valueOf === 'function') {
            return new Fraction(result.valueOf());
        }
        return new Fraction(result);
    } catch (e) {
        console.warn('evaluateExpressionSafe: Evaluation failed:', e.message);
        return null;
    }
}

/**
 * Build an evaluation cache from a module instance.
 * This cache provides the values needed for expression evaluation.
 *
 * @param {Object} moduleInstance - The module instance
 * @returns {Map} - Map from noteId to evaluated values object
 */
export function buildEvaluationCache(moduleInstance) {
    const cache = new Map();

    if (!moduleInstance) {
        return cache;
    }

    // Add baseNote as ID 0
    const baseNote = moduleInstance.baseNote;
    if (baseNote) {
        try {
            cache.set(0, {
                startTime: safeGetVariable(baseNote, 'startTime'),
                duration: safeGetVariable(baseNote, 'duration'),
                frequency: safeGetVariable(baseNote, 'frequency'),
                tempo: safeGetVariable(baseNote, 'tempo'),
                beatsPerMeasure: safeGetVariable(baseNote, 'beatsPerMeasure'),
                measureLength: moduleInstance.findMeasureLength ? moduleInstance.findMeasureLength(baseNote) : null
            });
        } catch (e) {
            console.warn('buildEvaluationCache: Error caching baseNote:', e);
        }
    }

    // Add all notes
    if (moduleInstance.notes) {
        for (const id in moduleInstance.notes) {
            const noteId = parseInt(id, 10);
            if (isNaN(noteId) || cache.has(noteId)) continue;

            const note = moduleInstance.notes[id];
            if (!note) continue;

            try {
                cache.set(noteId, {
                    startTime: safeGetVariable(note, 'startTime'),
                    duration: safeGetVariable(note, 'duration'),
                    frequency: safeGetVariable(note, 'frequency'),
                    tempo: moduleInstance.findTempo ? moduleInstance.findTempo(note) : null,
                    beatsPerMeasure: safeGetVariable(note, 'beatsPerMeasure'),
                    measureLength: moduleInstance.findMeasureLength ? moduleInstance.findMeasureLength(note) : null
                });
            } catch (e) {
                // Skip notes that can't be cached
            }
        }
    }

    return cache;
}

/**
 * Safely get a variable from a note, returning null on error
 */
function safeGetVariable(note, varName) {
    try {
        if (note && typeof note.getVariable === 'function') {
            return note.getVariable(varName);
        }
    } catch (e) {
        // Ignore errors
    }
    return null;
}

/**
 * Validate and normalize an expression for storage.
 * Returns the normalized expression string, or throws on invalid input.
 *
 * @param {string} expr - The expression to validate
 * @param {Object} moduleInstance - The module instance
 * @param {number} noteId - The note ID (for self-reference check)
 * @param {string} variableType - The variable type (startTime, duration, frequency)
 * @returns {string} - The validated/normalized expression
 * @throws {Error} - If the expression is invalid
 */
export function validateAndNormalizeExpression(expr, moduleInstance, noteId, variableType) {
    const exprStr = String(expr).trim();

    // Validate syntax
    const validation = validateExpressionSyntax(exprStr);
    if (!validation.valid) {
        throw new Error(validation.error);
    }

    // Check for self-reference
    if (noteId !== undefined && noteId !== null) {
        // DSL syntax self-reference check
        const dslSelfRef = new RegExp(`\\[${noteId}\\]\\.`);
        if (dslSelfRef.test(exprStr)) {
            throw new Error('Expression cannot reference itself directly');
        }

        // Legacy syntax self-reference check
        if (exprStr.includes(`getNoteById(${noteId})`)) {
            throw new Error('Expression cannot reference itself directly');
        }
    }

    // Try to evaluate to verify it produces a valid result
    if (moduleInstance) {
        const result = evaluateExpressionSafe(exprStr, moduleInstance);
        if (result === null) {
            throw new Error('Expression could not be evaluated');
        }

        // Check result type based on variable
        if (!(result instanceof Fraction) && typeof result !== 'number') {
            throw new Error(`Expression must result in a number or Fraction`);
        }
    }

    return exprStr;
}

/**
 * Check if a value looks like a legacy function-style expression.
 * These should be rejected as they indicate a potential attack or corruption.
 *
 * @param {*} value - The value to check
 * @returns {boolean} - True if it looks like a function expression
 */
export function isLegacyFunctionExpression(value) {
    if (typeof value !== 'string') {
        return false;
    }
    return value.includes('newFunc') ||
           value.includes('__evalExpr') ||
           value.includes('function') ||
           value.includes('=>');
}
