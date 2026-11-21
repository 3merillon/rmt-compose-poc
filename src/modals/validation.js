import { validateDSL, compileDSL } from '../dsl/index.js';
import { compiler } from '../expression-compiler.js';
import { isLegacyExpression } from '../migrate/legacy-syntax.js';
import { findDependencyCycle } from '../variable-deps.js';

export function validateExpression(moduleInstance, noteId, expression, variableType) {
    const expr = String(expression ?? '').trim();
    if (!expr) {
        throw new Error('Expression cannot be empty or undefined');
    }

    // The retired method-chain syntax is refused with its DSL form
    if (isLegacyExpression(expr)) compiler.compile(expr);

    return validateDSLExpression(moduleInstance, noteId, expr, variableType);
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
 * Whether saving `expression` as this variable would make a variable depend
 * on itself (a direct self-reference counts).
 */
export function detectCircularDependency(moduleInstance, noteId, expression, variableType) {
    const expr = String(expression ?? '').trim();
    let binary;
    try {
        binary = compiler.compile(expr);
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