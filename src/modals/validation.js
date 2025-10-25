import Fraction from 'fraction.js';

let dependencyGraphCache = null;
let lastGraphUpdateTime = 0;

export function validateExpression(moduleInstance, noteId, expression, variableType) {
    if (!expression || expression.trim() === '') {
        throw new Error('Expression cannot be empty or undefined');
    }

    if (expression.includes(`getNoteById(${noteId})`)) {
        throw new Error('Expression cannot reference itself directly');
    }
    
    if (detectCircularDependency(moduleInstance, noteId, expression, variableType)) {
        throw new Error('Circular dependency detected in expression');
    }
    
    let openParens = 0;
    for (const char of expression) {
        if (char === '(') openParens++;
        else if (char === ')') openParens--;
        if (openParens < 0) {
            throw new Error('Unbalanced parentheses: too many closing parentheses');
        }
    }
    if (openParens > 0) {
        throw new Error('Unbalanced parentheses: missing closing parentheses');
    }
    
    try {
        if (variableType === 'duration' && 
            expression.startsWith('new Fraction(60).div(') && 
            expression.includes(').mul(new Fraction(')) {
            
            const testFunc = new Function('module', 'Fraction', `
                return ${expression};
            `);
            const result = testFunc(moduleInstance, Fraction);
            
            if (!(result instanceof Fraction)) {
                throw new Error('Duration expression must result in a Fraction');
            }
            
            return expression;
        }
        
        const testFunc = new Function('module', 'Fraction', `
            let result = ${expression};
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
    const regex = /getNoteById\((\d+)\)/g;
    const references = new Set();
    let match;
    while ((match = regex.exec(expr)) !== null) {
        references.add(parseInt(match[1], 10));
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