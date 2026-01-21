import Fraction from 'fraction.js';
import { isDSLSyntax, validateDSL, compileDSL } from '../dsl/index.js';

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
    // Check for self-reference in DSL: [noteId].
    const selfRefPattern = new RegExp(`\\[${noteId}\\]\\.`);
    if (selfRefPattern.test(expr)) {
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

    // Detect whether expression contains references; if so, we preserve user-authored structure
    const hasRefs =
        /\.getVariable\s*\(/.test(expr) ||
        /module\.(?:baseNote|getNoteById|findTempo|findMeasureLength)\s*\(/.test(expr) ||
        /module\.baseNote/.test(expr);

    try {
        if (variableType === 'duration' &&
            expr.startsWith('new Fraction(60).div(') &&
            expr.includes(').mul(new Fraction(')) {
            const testFunc = new Function('module', 'Fraction', `return (${expr});`);
            const result = testFunc(moduleInstance, Fraction);
            if (!(result instanceof Fraction)) {
                throw new Error('Duration expression must result in a Fraction');
            }
            return expr;
        }

        const testFunc = new Function('module', 'Fraction', `
            let result = (${expr});
            if (result === undefined || result === null) {
                throw new Error('Expression resulted in undefined or null');
            }
            if (typeof result === 'number') {
                result = new Fraction(result);
            }
            if (!(result instanceof Fraction)) {
                throw new Error('Expression must result in a Fraction or a number');
            }
            return result;
        `);
        const result = testFunc(moduleInstance, Fraction);

        if (hasRefs) {
            // Keep dependency-carrying expressions intact
            return expr;
        }

        // Numeric-only expression: canonicalize to reduced Fraction literal
        return `new Fraction(${result.n}, ${result.d})`;
    } catch (e) {
        console.error(`Error in expression execution for Note ${noteId}:`, e);
        throw new Error(`Invalid expression: ${e.message}`);
    }
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