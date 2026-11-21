import type { Module } from '../module.ts';
import type { Note } from '../note.ts';
import type { ExpressionName } from '../model-types.ts';
/**
 * Safe Expression Validator and Evaluator
 *
 * This module provides safe validation and evaluation of expressions WITHOUT
 * using eval() or new Function(). Instead, it leverages the existing safe
 * compilation pipeline:
 *
 * 1. DSL expressions (e.g., "[1].f * (3/2)") → compiler.compile() → BinaryExpression
 * 2. BinaryExpression → BinaryEvaluator → Safe evaluation
 *
 * This prevents arbitrary code execution from malicious module.json files.
 */

import Fraction from 'fraction.js';
import { compiler } from '../expression-compiler.ts';
import { BinaryEvaluator } from '../binary-evaluator.ts';
import { findDependencyCycle } from '../variable-deps.ts';

/**
 * Validate that an expression string is safe to use.
 * Does NOT execute the expression, only validates its structure.
 *
 * @param {string} expr - The expression to validate
 * @returns {{valid: boolean, error?: string}} - Validation result
 */
export function validateExpressionSyntax(expr: unknown): { valid: true } | { valid: false; error: string } {
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

    // The DSL is inherently safe: it compiles to bytecode or fails to parse.
    try {
        compiler.compile(exprStr);
        return { valid: true };
    } catch (e) {
        return { valid: false, error: `Invalid expression: ${e instanceof Error ? e.message : String(e)}` };
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
export function evaluateExpressionSafe(expr: unknown, moduleInstance: Module | null | undefined, evalCache: Parameters<BinaryEvaluator['evaluate']>[1] = null): Fraction | null {
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
        const binary = compiler.compile(exprStr);

        // Build evaluation cache if not provided
        const cache = evalCache || buildEvaluationCache(moduleInstance);

        // Evaluate using the safe binary evaluator
        const evaluator = new BinaryEvaluator(moduleInstance);
        const result = evaluator.evaluate(binary, cache);

        return result;
    } catch (e) {
        console.warn('evaluateExpressionSafe: Evaluation failed:', e instanceof Error ? e.message : String(e));
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
export function buildEvaluationCache(moduleInstance: Module | null | undefined) {
    const cache = new Map<number, Record<ExpressionName, Fraction | null>>();

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
                amplitude: safeGetVariable(baseNote, 'amplitude'),
                attack: safeGetVariable(baseNote, 'attack'),
                release: safeGetVariable(baseNote, 'release')
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
                    amplitude: safeGetVariable(note, 'amplitude'),
                    attack: safeGetVariable(note, 'attack'),
                    release: safeGetVariable(note, 'release')
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
function safeGetVariable(note: Note, varName: ExpressionName) {
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
export function validateAndNormalizeExpression(expr: unknown, moduleInstance: Module | null, noteId: number | null | undefined, variableType: string) {
    const exprStr = String(expr).trim();

    // Validate syntax
    const validation = validateExpressionSyntax(exprStr);
    if (!validation.valid) {
        throw new Error(validation.error);
    }

    // Check for self-reference and circular dependencies. Per (note, variable),
    // like evaluation: reading another variable of the same note is fine, a
    // variable that ends up reading itself is not.
    if (noteId !== undefined && noteId !== null) {
        const binary = compiler.compile(exprStr);
        const cycle = findDependencyCycle(moduleInstance, noteId, variableType, binary);
        if (cycle) {
            throw new Error(cycle.length === 1
                ? 'Expression cannot reference itself directly'
                : 'Circular dependency detected in expression');
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
export function isLegacyFunctionExpression(value: unknown) {
    if (typeof value !== 'string') {
        return false;
    }
    return value.includes('newFunc') ||
           value.includes('__evalExpr') ||
           value.includes('function') ||
           value.includes('=>');
}
