import Fraction from 'fraction.js';
import { isDSLSyntax, validateDSL, compileDSL } from '../dsl/index.js';
import { ExpressionCompiler } from '../expression-compiler.js';
import { BinaryEvaluator } from '../binary-evaluator.js';
import { validateExpressionSyntax } from '../utils/safe-expression-validator.js';

// Singleton compiler for safe validation
const safeCompiler = new ExpressionCompiler();

let dependencyGraphCache = null;
let lastGraphUpdateTime = 0;

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
 * Validate DSL expression
 */
function validateDSLExpression(moduleInstance, noteId, expr, variableType) {
    // SECURITY: Check for self-reference using string method instead of dynamic RegExp
    // This prevents ReDoS if noteId contains regex special characters
    if (expr.includes(`[${noteId}].`)) {
        throw new Error('Expression cannot reference itself directly');
    }

    // Validate DSL syntax
    const validation = validateDSL(expr);
    if (!validation.valid) {
        throw new Error(`Invalid DSL expression: ${validation.error}`);
    }

    // Check for circular dependencies
    if (detectCircularDependency(moduleInstance, noteId, expr, variableType)) {
        throw new Error('Circular dependency detected in expression');
    }

    // Try to compile to verify it produces valid bytecode
    try {
        const binary = compileDSL(expr);
        // Successfully compiled - return the original DSL expression
        return expr;
    } catch (e) {
        throw new Error(`Invalid DSL expression: ${e.message}`);
    }
}

/**
 * Validate legacy (JavaScript-style) expression
 *
 * SECURITY: This function DOES NOT use eval() or new Function().
 * It validates expressions using safe pattern-based parsing and binary compilation.
 */
function validateLegacyExpression(moduleInstance, noteId, expr, variableType) {
    if (expr.includes(`getNoteById(${noteId})`)) {
        throw new Error('Expression cannot reference itself directly');
    }

    if (detectCircularDependency(moduleInstance, noteId, expr, variableType)) {
        throw new Error('Circular dependency detected in expression');
    }

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

    // Detect whether expression contains references; if so, we preserve user-authored structure
    const hasRefs =
        /\.getVariable\s*\(/.test(expr) ||
        /module\.(?:baseNote|getNoteById|findTempo|findMeasureLength)\s*\(/.test(expr) ||
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
        } else if (typeof result.valueOf === 'function') {
            fracResult = new Fraction(result.valueOf());
        } else {
            throw new Error('Expression must result in a Fraction or a number');
        }

        if (hasRefs) {
            // Keep dependency-carrying expressions intact
            return expr;
        }

        // Numeric-only expression: canonicalize to reduced Fraction literal
        const s = fracResult.s || 1;
        const n = fracResult.n || 0;
        const d = fracResult.d || 1;
        return `new Fraction(${s * n}, ${d})`;
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

    // Cache baseNote as ID 0
    const baseNote = moduleInstance.baseNote;
    if (baseNote) {
        try {
            cache.set(0, {
                startTime: baseNote.getVariable('startTime'),
                duration: baseNote.getVariable('duration'),
                frequency: baseNote.getVariable('frequency'),
                tempo: baseNote.getVariable('tempo'),
                beatsPerMeasure: baseNote.getVariable('beatsPerMeasure'),
                measureLength: moduleInstance.findMeasureLength ? moduleInstance.findMeasureLength(baseNote) : null
            });
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
                cache.set(noteId, {
                    startTime: note.getVariable ? note.getVariable('startTime') : null,
                    duration: note.getVariable ? note.getVariable('duration') : null,
                    frequency: note.getVariable ? note.getVariable('frequency') : null,
                    tempo: moduleInstance.findTempo ? moduleInstance.findTempo(note) : null,
                    beatsPerMeasure: note.getVariable ? note.getVariable('beatsPerMeasure') : null,
                    measureLength: moduleInstance.findMeasureLength ? moduleInstance.findMeasureLength(note) : null
                });
            } catch (e) { /* ignore individual note errors */ }
        }
    }

    return cache;
}

export function detectCircularDependency(moduleInstance, noteId, expression, variableType) {
    const newReferences = findReferences(expression);
    
    const currentModifiedTime = getModuleModifiedTime(moduleInstance);
    
    if (!dependencyGraphCache || currentModifiedTime > lastGraphUpdateTime) {
        dependencyGraphCache = buildDependencyGraph(moduleInstance);
        lastGraphUpdateTime = currentModifiedTime;
    }
    
    const tempGraph = JSON.parse(JSON.stringify(dependencyGraphCache));
    
    if (!tempGraph[noteId]) {
        tempGraph[noteId] = [];
    }
    
    for (const refId of newReferences) {
        if (!tempGraph[noteId].includes(refId)) {
            tempGraph[noteId].push(refId);
        }
    }
    
    for (const refId of newReferences) {
        if (hasPath(tempGraph, refId, noteId)) {
            return true;
        }
    }
    
    return false;
}

function findReferences(expr) {
    const references = new Set();

    // Legacy syntax: getNoteById(123)
    const legacyRegex = /getNoteById\((\d+)\)/g;
    let match;
    while ((match = legacyRegex.exec(expr)) !== null) {
        const noteId = parseInt(match[1], 10);
        if (noteId !== 0) { // 0 is baseNote, not a dependency
            references.add(noteId);
        }
    }

    // DSL syntax: [123].property or tempo([123]) etc.
    const dslRegex = /\[(\d+)\]/g;
    while ((match = dslRegex.exec(expr)) !== null) {
        const noteId = parseInt(match[1], 10);
        if (noteId !== 0) { // 0 is baseNote, not a dependency
            references.add(noteId);
        }
    }

    return Array.from(references);
}

function buildDependencyGraph(moduleInstance) {
    const graph = {};
    
    for (const id in moduleInstance.notes) {
        graph[id] = [];
    }
    
    for (const id in moduleInstance.notes) {
        const note = moduleInstance.notes[id];
        if (!note || !note.variables) continue;
        
        const deps = moduleInstance.getDirectDependencies(parseInt(id, 10));
        
        for (const depId of deps) {
            if (!graph[id].includes(depId)) {
                graph[id].push(depId);
            }
        }
    }
    
    return graph;
}

function hasPath(graph, start, end) {
    if (start === end) return true;
    
    const visited = new Set();
    const queue = [start];
    
    while (queue.length > 0) {
        const current = queue.shift();
        
        if (current === end) {
            return true;
        }
        
        if (visited.has(current)) {
            continue;
        }
        
        visited.add(current);
        
        if (graph[current]) {
            for (const neighbor of graph[current]) {
                if (!visited.has(neighbor)) {
                    queue.push(neighbor);
                }
            }
        }
    }
    
    return false;
}

function getModuleModifiedTime(moduleInstance) {
    if (!moduleInstance || !moduleInstance.notes) {
        return 0;
    }
    
    return Object.values(moduleInstance.notes).reduce((maxTime, note) => {
        const noteTime = note.lastModifiedTime || 0;
        return Math.max(maxTime, noteTime);
    }, 0);
}

export function invalidateDependencyGraphCache() {
    dependencyGraphCache = null;
}