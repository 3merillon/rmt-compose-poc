import Fraction from 'fraction.js';
import { createVariableControls } from './variable-controls.js';
import { createAddNoteSection, createAddMeasureSection } from './note-creation.js';
import { createEvaluateSection, createDeleteSection } from './note-actions.js';
import { 
    validateExpression, 
    detectCircularDependency,
    invalidateDependencyGraphCache 
} from './validation.js';
import { eventBus } from '../utils/event-bus.js';
import { getModule, setEvaluatedNotes } from '../store/app-state.js';

const domCache = {
    noteWidget: null,
    closeWidgetBtn: null,
    widgetContent: null,
    widgetTitle: null
};

let currentSelectedNote = null;
let widgetInitiallyOpened = false;
const TOP_HEADER_HEIGHT = 50;
const MIN_BUFFER = 19;

let externalFunctions = {
    updateVisualNotes: null,
    updateBaseNoteFraction: null,
    updateBaseNotePosition: null,
    hasMeasurePoints: null,
    getLastMeasureId: null,
    updateTimingBoundaries: null,
    createMeasureBars: null,
    deleteNoteAndDependencies: null,
    deleteNoteKeepDependencies: null,
    checkAndUpdateDependentNotes: null,
    cleanSlate: null,
    bringSelectedNoteToFront: null,
    restoreNotePosition: null,
    clearLastSelectedNote: null,
    originalNoteOrder: null,
    updateDependentRawExpressions: null,
    isLastMeasureInChain: null
};

export function setExternalFunctions(functions) {
    Object.assign(externalFunctions, functions);
}

export function getExternalFunctions() {
    return externalFunctions;
}

function batchClassOperation(elements, classesToAdd = [], classesToRemove = []) {
    if (!elements || elements.length === 0) return;
    
    const BATCH_SIZE = 50;
    const total = elements.length;
    
    for (let i = 0; i < total; i += BATCH_SIZE) {
        const batch = Array.from(elements).slice(i, i + BATCH_SIZE);
        
        requestAnimationFrame(() => {
            batch.forEach(el => {
                if (classesToRemove.length > 0) {
                    el.classList.remove(...classesToRemove);
                }
                if (classesToAdd.length > 0) {
                    el.classList.add(...classesToAdd);
                }
            });
        });
    }
}

export function showNoteVariables(note, clickedElement, measureId = null) {
    // Guard against early calls before the module is registered
    const moduleInstance = (typeof getModule === 'function') ? getModule() : null;
    if (!moduleInstance || !moduleInstance.baseNote) {
        console.warn('modals.showNoteVariables called before module is ready');
        return;
    }

    const effectiveNoteId = (note && note.id !== undefined) ? note.id : measureId;
    if (effectiveNoteId === undefined) {
        console.error("No valid note id found for dependency highlighting.");
        return;
    }
    
    const widgetContent = domCache.widgetContent;
    const widgetTitle = domCache.widgetTitle;
    
    const isSilence = note && note.getVariable('startTime') &&
                     note.getVariable('duration') &&
                     !note.getVariable('frequency');
    
    if (note === moduleInstance.baseNote) {
        widgetTitle.textContent = 'BaseNote Variables';
    } else if (measureId !== null) {
        widgetTitle.textContent = `Measure [${measureId}] Variables`;
    } else if (isSilence) {
        widgetTitle.textContent = `Silence [${effectiveNoteId || 'unknown'}] Variables`;
    } else {
        widgetTitle.textContent = `Note [${effectiveNoteId || 'unknown'}] Variables`;
    }
    
    widgetContent.innerHTML = '';
    
    const selectedElements = document.querySelectorAll('.note-content.selected, .base-note-circle.selected, .measure-bar-triangle.selected');
    selectedElements.forEach(el => {
        if (el.getAttribute('data-note-id') !== String(note.id)) {
            el.classList.remove('selected');
        }
    });
    
    document.querySelectorAll('.dependency, .dependent').forEach(el => {
        el.classList.remove('dependency', 'dependent');
    });
    
    if (clickedElement) {
        clickedElement.classList.add('selected');
    }
    
    if (note !== moduleInstance.baseNote && effectiveNoteId !== undefined) {
        highlightDependencies(effectiveNoteId);
    }
    
    const variables = collectVariables(note, measureId, moduleInstance);
    
    Object.entries(variables).forEach(([key, value]) => {
        const variableRow = createVariableControls(key, value, note, measureId, externalFunctions);
        widgetContent.appendChild(variableRow);
    });
    
    // Add creation sections
    const shouldShowAddMeasure = note === moduleInstance.baseNote ||
        (measureId !== null && externalFunctions.isLastMeasureInChain(measureId));
    
    if (shouldShowAddMeasure) {
        const measureSection = createAddMeasureSection(note, measureId, externalFunctions);
        widgetContent.appendChild(measureSection);
    }

    if (note !== moduleInstance.baseNote && !(measureId !== null)) {
        const noteSection = createAddNoteSection(note, false, externalFunctions);
        widgetContent.appendChild(noteSection);
    }

    if (note === moduleInstance.baseNote) {
        const noteSection = createAddNoteSection(note, true, externalFunctions);
        widgetContent.appendChild(noteSection);
    }
    
    // Add evaluate section
    const evaluateSection = createEvaluateSection(note, measureId, effectiveNoteId, modals);
    if (evaluateSection) {
        widgetContent.appendChild(evaluateSection);
    }
    
    // Add delete section
    const deleteSection = createDeleteSection(note, effectiveNoteId, externalFunctions, modals);
    if (deleteSection) {
        widgetContent.appendChild(deleteSection);
    }
    
    domCache.noteWidget.classList.add('visible');
    widgetInitiallyOpened = true;
    updateNoteWidgetHeight();

    if (!clickedElement && note && note.id !== undefined) {
        const selElem = document.querySelector(`[data-note-id="${note.id}"]`);
        if (selElem) {
            selElem.classList.add("selected");
        }
    }
    
    currentSelectedNote = note;
    try { eventBus.emit('modals:show', { noteId: effectiveNoteId, isMeasure: measureId !== null }); } catch (e) {}
}

function highlightDependencies(selfNoteId) {
    const elementMap = new Map();
    
    const allHighlightableElements = document.querySelectorAll('.note-content, .base-note-circle, .measure-bar-triangle');
    allHighlightableElements.forEach(el => {
        const id = el.getAttribute('data-note-id');
        if (id) {
            if (!elementMap.has(id)) {
                elementMap.set(id, []);
            }
            elementMap.get(id).push(el);
        }
    });
    
    const directDeps = getModule().getDirectDependencies(selfNoteId).filter(depId => depId !== selfNoteId);
    const dependents = getModule().getDependentNotes(selfNoteId).filter(depId => depId !== selfNoteId);
    
    directDeps.forEach(depId => {
        const elements = elementMap.get(String(depId));
        if (elements) {
            elements.forEach(el => el.classList.add('dependency'));
        }
    });
    
    dependents.forEach(depId => {
        const elements = elementMap.get(String(depId));
        if (elements) {
            elements.forEach(el => el.classList.add('dependent'));
        }
    });
}

function collectVariables(note, measureId, moduleInstance) {
    let variables = {};
    const module = moduleInstance || (typeof getModule === 'function' ? getModule() : null);
    if (!module || !module.baseNote) {
        return variables;
    }
    
    if (note === module.baseNote) {
        Object.keys(note.variables).forEach(key => {
            if (!key.endsWith('String') && key !== 'measureLength') {
                variables[key] = {
                    evaluated: note.getVariable(key),
                    raw: note.variables[key + 'String'] || note.variables[key].toString()
                };
            }
        });
        
        if (!variables.instrument) {
            variables.instrument = {
                evaluated: note.getVariable('instrument') || 'sine-wave',
                raw: note.getVariable('instrument') || 'sine-wave',
                isInherited: false
            };
        }
    } else if (measureId !== null) {
        const noteInstance = module.getNoteById(parseInt(measureId, 10));
        if (noteInstance && typeof noteInstance.getVariable === 'function') {
            variables.startTime = {
                evaluated: noteInstance.getVariable('startTime'),
                raw: noteInstance.variables.startTimeString || "undefined"
            };
        } else {
            console.error("Invalid measure note:", noteInstance);
        }
    } else {
        const variableNames = ['startTime', 'duration', 'frequency', 'color'];
        variableNames.forEach(key => {
            if (note.variables && note.variables[key] !== undefined) {
                if (key === 'color') {
                    const value = note.getVariable(key);
                    variables[key] = { evaluated: value, raw: value };
                } else {
                    variables[key] = {
                        evaluated: note.getVariable(key),
                        raw: note.variables[key + 'String'] || note.variables[key].toString()
                    };
                }
            }
        });
        
        const hasOwnInstrument = note.variables.instrument !== undefined;
        const inheritedInstrument = module.findInstrument(note);

        variables.instrument = {
            evaluated: hasOwnInstrument ? note.getVariable('instrument') : inheritedInstrument,
            raw: hasOwnInstrument ? note.getVariable('instrument') : inheritedInstrument,
            isInherited: !hasOwnInstrument
        };
    }
    
    return variables;
}

export function clearSelection() {
    if (externalFunctions.clearLastSelectedNote) {
      externalFunctions.clearLastSelectedNote();
    }

    domCache.noteWidget.classList.remove('visible');
    currentSelectedNote = null;
    
    const elementsToClean = document.querySelectorAll(
      '.note-content.selected, .base-note-circle.selected, .measure-bar-triangle.selected, ' +
      '.note-content.dependency, .note-content.dependent, .base-note-circle.dependency, ' +
      '.measure-bar-triangle.dependency, .measure-bar-triangle.dependent'
    );
    
    batchClassOperation(elementsToClean, [], ['selected', 'dependency', 'dependent']);
    
    const baseNoteCircle = document.getElementById('baseNoteCircle');
    if (baseNoteCircle) {
      baseNoteCircle.classList.remove('selected', 'dependency', 'dependent');
    }
    
    if (externalFunctions.originalNoteOrder) {
      externalFunctions.originalNoteOrder.forEach((noteData, noteId) => {
        const note = getModule().getNoteById(parseInt(noteId, 10));
        if (note && externalFunctions.restoreNotePosition) {
          externalFunctions.restoreNotePosition(note);
        }
      });
      externalFunctions.originalNoteOrder.clear();
    }
    try { eventBus.emit('modals:cleared'); } catch (e) {}
}

export function updateNoteWidgetHeight() {
    const widget = domCache.noteWidget;
    if (!widget) return;

    const header = widget.querySelector('.note-widget-header');
    const content = widget.querySelector('.note-widget-content');
    if (!header || !content) return;
    
    const headerHeight = header.offsetHeight;
    const rect = widget.getBoundingClientRect();
    const availableSpace = window.innerHeight - rect.top - MIN_BUFFER;
    const contentNaturalHeight = content.scrollHeight;
    const PADDING = 5;
    const widgetDesiredHeight = headerHeight + contentNaturalHeight + PADDING;
    const minInitialHeight = widgetInitiallyOpened ? 40 : 300;
    const effectiveHeight = Math.max(minInitialHeight, Math.min(availableSpace, widgetDesiredHeight));
    
    widget.style.height = effectiveHeight + "px";
    const contentHeight = effectiveHeight - headerHeight - PADDING;
    content.style.height = Math.max(40, contentHeight) + "px";
    content.style.overflowY = "auto";
}

function handleWindowResize() {
    const widget = domCache.noteWidget;
    if (!widget || !widget.classList.contains('visible')) return;

    const header = widget.querySelector('.note-widget-header');
    const headerHeight = header ? header.getBoundingClientRect().height : 0;
    const rect = widget.getBoundingClientRect();

    const availableHeight = window.innerHeight - TOP_HEADER_HEIGHT + 5;
    const maxWidgetHeight = availableHeight - headerHeight;

    const maxLeft = window.innerWidth - rect.width - MIN_BUFFER;
    const maxTop = window.innerHeight - Math.min(rect.height, maxWidgetHeight) - MIN_BUFFER;

    if (rect.right > window.innerWidth - MIN_BUFFER) {
        widget.style.left = Math.max(MIN_BUFFER, maxLeft) + "px";
    }

    if (rect.bottom > window.innerHeight - MIN_BUFFER) {
        widget.style.top = Math.max(TOP_HEADER_HEIGHT + MIN_BUFFER, maxTop) + "px";
    }

    if (rect.top < TOP_HEADER_HEIGHT + MIN_BUFFER) {
        widget.style.top = (TOP_HEADER_HEIGHT + MIN_BUFFER) + "px";
    }

    updateNoteWidgetHeight();
}

function addDraggableNoteWidget() {
    const widget = domCache.noteWidget;
    if (!widget) return;

    widget.style.position = 'fixed';
    const header = widget.querySelector('.note-widget-header');
    if (!header) return;

    let isDragging = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;

    header.addEventListener('mousedown', startDrag);
    header.addEventListener('touchstart', startDrag, {passive: false});

    function startDrag(e) {
        if (e.target.classList.contains('note-widget-close')) return;
        isDragging = true;
        e.preventDefault();
        const rect = widget.getBoundingClientRect();
        
        let clientX = e.clientX;
        let clientY = e.clientY;
        if (e.touches && e.touches.length > 0) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        }
        dragOffsetX = clientX - rect.left;
        dragOffsetY = clientY - rect.top;
        
        document.addEventListener('mousemove', duringDrag);
        document.addEventListener('touchmove', duringDrag, {passive: false});
        document.addEventListener('mouseup', endDrag);
        document.addEventListener('touchend', endDrag);
    }

    function duringDrag(e) {
        if (!isDragging) return;
        e.preventDefault();
        
        let clientX = e.clientX;
        let clientY = e.clientY;
        if (e.touches && e.touches.length > 0) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        }
        
        let newLeft = clientX - dragOffsetX;
        let newTop = clientY - dragOffsetY;
        
        const widgetRect = widget.getBoundingClientRect();
        const maxLeft = window.innerWidth - widgetRect.width - MIN_BUFFER;
        newLeft = Math.max(MIN_BUFFER, Math.min(newLeft, maxLeft));
        
        const headerHeight = widget.querySelector('.note-widget-header')?.getBoundingClientRect().height || TOP_HEADER_HEIGHT;
        const minTop = TOP_HEADER_HEIGHT + MIN_BUFFER;
        const maxTop = window.innerHeight - headerHeight - MIN_BUFFER;
        newTop = Math.max(minTop, Math.min(newTop, maxTop));
        
        widget.style.left = newLeft + "px";
        widget.style.top = newTop + "px";
        
        updateNoteWidgetHeight();
    }

    function endDrag(e) {
        isDragging = false;
        document.removeEventListener('mousemove', duringDrag);
        document.removeEventListener('touchmove', duringDrag);
        document.removeEventListener('mouseup', endDrag);
        document.removeEventListener('touchend', endDrag);
    }
}

export function showDeleteConfirmation(noteId) {
    const overlay = document.createElement('div');
    overlay.className = 'delete-confirm-overlay';

    const modal = document.createElement('div');
    modal.className = 'delete-confirm-modal';

    const message = document.createElement('p');
    message.innerHTML = "Are you sure you want to <strong>DELETE</strong> Note[<span class='modal-note-id'>" 
        + noteId + "</span>] and <span class='modal-delete-all'>DELETE ALL</span> its Dependencies (notes highlighted in red)?";
    modal.appendChild(message);

    const btnContainer = document.createElement('div');
    btnContainer.className = 'modal-btn-container';

    const yesButton = document.createElement('button');
    yesButton.textContent = 'Yes';
    yesButton.addEventListener('click', function(e) {
        e.stopPropagation();
        try { eventBus.emit('player:requestPause'); } catch {}
        externalFunctions.deleteNoteAndDependencies(noteId);
        document.body.removeChild(overlay);
    });

    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', function(e) {
        e.stopPropagation();
        document.body.removeChild(overlay);
    });

    btnContainer.appendChild(yesButton);
    btnContainer.appendChild(cancelButton);
    modal.appendChild(btnContainer);
    overlay.appendChild(modal);

    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) {
            e.stopPropagation();
            document.body.removeChild(overlay);
        }
    });

    document.body.appendChild(overlay);
}

export function showDeleteConfirmationKeepDependencies(noteId) {
    const overlay = document.createElement('div');
    overlay.className = 'delete-confirm-overlay';

    const modal = document.createElement('div');
    modal.className = 'delete-confirm-modal';

    const message = document.createElement('p');
    message.innerHTML = "Are you sure you want to <strong>DELETE</strong> Note[<span class='modal-note-id'>" 
       + noteId + "</span>] and <span class='modal-keep'>KEEP</span> its Dependencies? Dependent notes will update their references using this note's raw values.";
    modal.appendChild(message);

    const btnContainer = document.createElement('div');
    btnContainer.className = 'modal-btn-container';

    const yesButton = document.createElement('button');
    yesButton.textContent = 'Yes';
    yesButton.addEventListener('click', function(e) {
        e.stopPropagation();
        try { eventBus.emit('player:requestPause'); } catch {}
        externalFunctions.deleteNoteKeepDependencies(noteId);
        document.body.removeChild(overlay);
    });

    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', function(e) {
        e.stopPropagation();
        document.body.removeChild(overlay);
    });

    btnContainer.appendChild(yesButton);
    btnContainer.appendChild(cancelButton);
    modal.appendChild(btnContainer);
    overlay.appendChild(modal);

    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) {
            e.stopPropagation();
            document.body.removeChild(overlay);
        }
    });

    document.body.appendChild(overlay);
}

export function showCleanSlateConfirmation() {
    const overlay = document.createElement('div');
    overlay.className = 'delete-confirm-overlay';

    const modal = document.createElement('div');
    modal.className = 'delete-confirm-modal';

    const message = document.createElement('p');
    message.innerHTML = "Are you sure you want to <span class='modal-delete-all'>DELETE ALL</span> notes except the base note? This action cannot be undone.";
    modal.appendChild(message);

    const btnContainer = document.createElement('div');
    btnContainer.className = 'modal-btn-container';

    const yesButton = document.createElement('button');
    yesButton.textContent = 'Yes, Clean Slate';
    yesButton.addEventListener('click', function(e) {
        e.stopPropagation();
        try { eventBus.emit('player:requestPause'); } catch {}
        externalFunctions.cleanSlate();
        document.body.removeChild(overlay);
    });

    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', function(e) {
        e.stopPropagation();
        document.body.removeChild(overlay);
    });

    btnContainer.appendChild(yesButton);
    btnContainer.appendChild(cancelButton);
    modal.appendChild(btnContainer);
    overlay.appendChild(modal);

    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) {
            e.stopPropagation();
            document.body.removeChild(overlay);
        }
    });

    document.body.appendChild(overlay);
}

// ===== Evaluation and Liberation helpers ported from legacy modals.js =====

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.textContent = message;
    Object.assign(notification.style, {
        position: 'fixed', bottom: '20px', right: '20px', padding: '10px 20px', borderRadius: '4px',
        zIndex: '9999', fontFamily: "'Roboto Mono', monospace", fontSize: '14px', transition: 'opacity 0.3s ease-in-out'
    });
    if (type === 'success') {
        Object.assign(notification.style, { backgroundColor: 'rgba(0, 255, 255, 0.8)', color: '#151525' });
    } else if (type === 'error') {
        Object.assign(notification.style, { backgroundColor: 'rgba(255, 0, 0, 0.8)', color: '#fff' });
    } else {
        Object.assign(notification.style, { backgroundColor: 'rgba(255, 168, 0, 0.8)', color: '#000' });
    }
    document.body.appendChild(notification);
    setTimeout(() => {
        notification.style.opacity = '0';
        setTimeout(() => { if (notification.parentNode) document.body.removeChild(notification); }, 300);
    }, 3000);
}

function findGCD(a, b) {
    a = Math.abs(a);
    b = Math.abs(b);
    while (b) {
        const temp = b;
        b = a % b;
        a = temp;
    }
    return a;
}

function balanceParentheses(expr) {
    let openCount = 0;
    for (const char of expr) {
        if (char === '(') openCount++;
        else if (char === ')') openCount--;
    }
    if (openCount > 0) expr += ')'.repeat(openCount);
    if (openCount < 0) {
        while (openCount < 0 && expr.endsWith(')')) {
            expr = expr.slice(0, -1);
            openCount++;
        }
    }
    return expr;
}

function removeExcessParentheses(expr) {
    let result = expr;
    let prev = '';
    while (prev !== result) {
        prev = result;
        result = result.replace(/\(\(([^()]*)\)\)/g, '($1)');
    }
    return result;
}

function simplifyFrequencyExpression(expr) {
    try {
        if (!expr.includes("module.baseNote.getVariable('frequency')") || !expr.includes("new Fraction")) {
            return expr;
        }
        const fractions = [];
        const fractionRegex = /new\s+Fraction\((\d+),\s*(\d+)\)/g;
        let match;
        while ((match = fractionRegex.exec(expr)) !== null) {
            fractions.push({ n: parseInt(match[1], 10), d: parseInt(match[2], 10) });
        }
        if (fractions.length > 1) {
            let resultN = 1, resultD = 1;
            fractions.forEach(frac => { resultN *= frac.n; resultD *= frac.d; });
            const gcd = findGCD(resultN, resultD);
            resultN /= gcd; resultD /= gcd;
            return `new Fraction(${resultN}, ${resultD}).mul(module.baseNote.getVariable('frequency'))`;
        }
    } catch (error) {
        console.error("Error simplifying frequency expression:", error);
    }
    return expr;
}

function simplifyDurationExpression(expr) {
    try {
        const simpleDurationPattern = /^new\s+Fraction\(60\)\.div\(module\.findTempo\(module\.baseNote\)\)\.mul\(([^)]+)\)$/;
        const match = expr.match(simpleDurationPattern);
        if (match) return expr;

        const tempoTerms = [];
        const tempoRegex = /new\s+Fraction\(60\)\.div\(module\.findTempo\(module\.baseNote\)\)\.mul\(([^)]+)\)/g;
        let tempMatch;
        while ((tempMatch = tempoRegex.exec(expr)) !== null) {
            const multiplier = parseFloat(tempMatch[1]);
            if (!isNaN(multiplier)) tempoTerms.push({ term: tempMatch[0], multiplier });
        }
        if (tempoTerms.length > 1) {
            const totalMultiplier = tempoTerms.reduce((sum, t) => sum + t.multiplier, 0);
            const isSimpleAddition = expr
                .replace(/new\s+Fraction\(60\)\.div\(module\.findTempo\(module\.baseNote\)\)\.mul\([^)]+\)/g, '')
                .replace(/\.\s*add\s*\(/g, '')
                .replace(/\)/g, '')
                .trim() === '';
            if (isSimpleAddition) {
                return `new Fraction(60).div(module.findTempo(module.baseNote)).mul(${totalMultiplier})`;
            }
        }
    } catch (error) {
        console.error("Error simplifying duration expression:", error);
    }
    return expr;
}

function parseAndSimplifyExpression(expr) {
    try {
        let normalizedExpr = expr.replace(/\(\(/g, '(').replace(/\)\)/g, ')');
        while (normalizedExpr !== expr) {
            expr = normalizedExpr;
            normalizedExpr = expr.replace(/\(\(/g, '(').replace(/\)\)/g, ')');
        }
        function parseExpr(e) {
            if (!e.includes('.add(')) return { type: 'term', value: e };
            let depth = 0, addIndex = -1;
            for (let i = 0; i < e.length - 4; i++) {
                if (e[i] === '(') depth++;
                else if (e[i] === ')') depth--;
                if (depth === 0 && e.substring(i, i + 5) === '.add(') { addIndex = i; break; }
            }
            if (addIndex === -1) return { type: 'term', value: e };
            const left = e.substring(0, addIndex);
            depth = 1; let closeIndex = -1;
            for (let i = addIndex + 5; i < e.length; i++) {
                if (e[i] === '(') depth++;
                else if (e[i] === ')') {
                    depth--;
                    if (depth === 0) { closeIndex = i; break; }
                }
            }
            if (closeIndex === -1) return { type: 'term', value: e };
            const right = e.substring(addIndex + 5, closeIndex);
            return { type: 'add', left: parseExpr(left), right: parseExpr(right) };
        }
        function analyzeTree(node) {
            const result = { baseStartTime: false, measureTerms: [], tempoTerms: [] };
            if (node.type === 'term') {
                const term = node.value;
                if (term.includes("module.baseNote.getVariable('startTime')") && !term.includes('.add(')) {
                    result.baseStartTime = true;
                }
                const complexMeasureMatch = term.match(/new\s+Fraction\((\d+)\)\.mul\(module\.findMeasureLength\(module\.baseNote\)\)/);
                if (complexMeasureMatch) {
                    const multiplier = parseInt(complexMeasureMatch[1], 10);
                    if (!isNaN(multiplier)) result.measureTerms.push(multiplier);
                } else if (term === 'module.findMeasureLength(module.baseNote)') {
                    result.measureTerms.push(1);
                }
                const complexTempoMatch = term.match(/new\s+Fraction\(60\)\.div\(module\.findTempo\(module\.baseNote\)\)\.mul\(([^)]+)\)/);
                if (complexTempoMatch) {
                    const multiplier = parseFloat(complexTempoMatch[1]);
                    if (!isNaN(multiplier)) result.tempoTerms.push(multiplier);
                } else if (term === 'new Fraction(60).div(module.findTempo(module.baseNote))') {
                    result.tempoTerms.push(1);
                }
                return result;
            }
            if (node.type === 'add') {
                const leftResult = analyzeTree(node.left);
                const rightResult = analyzeTree(node.right);
                return {
                    baseStartTime: leftResult.baseStartTime || rightResult.baseStartTime,
                    measureTerms: [...leftResult.measureTerms, ...rightResult.measureTerms],
                    tempoTerms: [...leftResult.tempoTerms, ...rightResult.tempoTerms]
                };
            }
            return result;
        }
        const parsedExpr = parseExpr(normalizedExpr);
        const analysis = analyzeTree(parsedExpr);
        if (analysis.baseStartTime && (analysis.measureTerms.length > 0 || analysis.tempoTerms.length > 0)) {
            let newExpr = "module.baseNote.getVariable('startTime')";
            if (analysis.measureTerms.length > 0) {
                const totalMeasures = analysis.measureTerms.reduce((s, v) => s + v, 0);
                if (totalMeasures === 1) newExpr += ".add(module.findMeasureLength(module.baseNote))";
                else newExpr += `.add(new Fraction(${totalMeasures}).mul(module.findMeasureLength(module.baseNote)))`;
            }
            if (analysis.tempoTerms.length > 0) {
                const totalMultiplier = analysis.tempoTerms.reduce((s, v) => s + v, 0);
                if (totalMultiplier === 1) newExpr += `.add(new Fraction(60).div(module.findTempo(module.baseNote)))`;
                else {
                    const fracObj = new Fraction(totalMultiplier);
                    newExpr += `.add(new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(${fracObj.n}, ${fracObj.d})))`;
                }
            }
            try {
                const originalFunc = new Function("module", "Fraction", "return " + expr + ";");
                const newFunc = new Function("module", "Fraction", "return " + newExpr + ";");
                const originalValue = originalFunc(getModule(), Fraction).valueOf();
                const newValue = newFunc(getModule(), Fraction).valueOf();
                if (Math.abs(originalValue - newValue) < 0.0001) return newExpr;
            } catch (evalError) {
                console.error("Error evaluating expressions in tree-based approach:", evalError);
            }
        }
    } catch (error) {
        console.error("Error in tree-based simplification:", error);
    }
    return expr;
}

function simplifyStartTimeExpressionWithRegex(expr) {
    try {
        if (!expr.includes("module.baseNote.getVariable('startTime')")) return expr;
        const measureTerms = [];
        const complexMeasureRegex = /new\s+Fraction\((\d+)\)\.mul\(module\.findMeasureLength\(module\.baseNote\)\)/g;
        let complexMeasureMatch, tempExpr = expr;
        while ((complexMeasureMatch = complexMeasureRegex.exec(tempExpr)) !== null) {
            const multiplier = parseInt(complexMeasureMatch[1], 10);
            if (!isNaN(multiplier)) measureTerms.push(multiplier);
        }
        const simpleMeasureRegex = /module\.findMeasureLength\(module\.baseNote\)/g;
        let simpleMeasureMatch;
        tempExpr = expr;
        while ((simpleMeasureMatch = simpleMeasureRegex.exec(tempExpr)) !== null) {
            const beforeMatch = tempExpr.substring(0, simpleMeasureMatch.index);
            const lastMulIndex = beforeMatch.lastIndexOf(".mul(");
            if (lastMulIndex === -1 || simpleMeasureMatch.index - lastMulIndex > 50) measureTerms.push(1);
        }
        const tempoTerms = [];
        const simpleTempoRegex = /new\s+Fraction\(60\)\.div\(module\.findTempo\(module\.baseNote\)\)(?!\.mul)/g;
        let simpleTempoMatch;
        while ((simpleTempoMatch = simpleTempoRegex.exec(expr)) !== null) tempoTerms.push(1);
        const complexTempoRegex = /new\s+Fraction\(60\)\.div\(module\.findTempo\(module\.baseNote\)\)\.mul\((?:new\s+Fraction\((\d+),\s*(\d+)\)|([^)]+))\)/g;
        let complexTempoMatch;
        while ((complexTempoMatch = complexTempoRegex.exec(expr)) !== null) {
            if (complexTempoMatch[1] !== undefined && complexTempoMatch[2] !== undefined) {
                const numerator = parseInt(complexTempoMatch[1], 10);
                const denominator = parseInt(complexTempoMatch[2], 10);
                if (!isNaN(numerator) && !isNaN(denominator) && denominator !== 0) {
                    tempoTerms.push(numerator / denominator);
                }
            } else if (complexTempoMatch[3] !== undefined) {
                const multiplier = parseFloat(complexTempoMatch[3]);
                if (!isNaN(multiplier)) tempoTerms.push(multiplier);
            }
        }
        if (measureTerms.length > 0 || tempoTerms.length > 0) {
            let newExpr = "module.baseNote.getVariable('startTime')";
            if (measureTerms.length > 0) {
                const totalMeasures = measureTerms.reduce((s, v) => s + v, 0);
                if (totalMeasures === 1) newExpr += ".add(module.findMeasureLength(module.baseNote))";
                else newExpr += `.add(new Fraction(${totalMeasures}).mul(module.findMeasureLength(module.baseNote)))`;
            }
            if (tempoTerms.length > 0) {
                const totalMultiplier = tempoTerms.reduce((s, v) => s + v, 0);
                if (totalMultiplier === 1) newExpr += `.add(new Fraction(60).div(module.findTempo(module.baseNote)))`;
                else {
                    const fracObj = new Fraction(totalMultiplier);
                    newExpr += `.add(new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(${fracObj.n}, ${fracObj.d})))`;
                }
            }
            try {
                const originalFunc = new Function("module", "Fraction", "return " + expr + ";");
                const newFunc = new Function("module", "Fraction", "return " + newExpr + ";");
                const originalValue = originalFunc(getModule(), Fraction).valueOf();
                const newValue = newFunc(getModule(), Fraction).valueOf();
                if (Math.abs(originalValue - newValue) < 0.0001) return newExpr;
            } catch (evalError) {
                console.error("Error evaluating expressions:", evalError);
            }
        }
    } catch (error) {
        console.error("Error simplifying startTime expression:", error);
    }
    return expr;
}

function simplifyStartTimeExpression(expr) {
    try {
        const regexResult = simplifyStartTimeExpressionWithRegex(expr);
        if (regexResult === expr) return parseAndSimplifyExpression(expr);
        return regexResult;
    } catch (error) {
        console.error("Error in simplifyStartTimeExpression:", error);
        return expr;
    }
}

function simplifyExpressions(expr) {
    try {
        let simplified = removeExcessParentheses(expr);
        if (simplified.includes("module.baseNote.getVariable('frequency')")) {
            simplified = simplifyFrequencyExpression(simplified);
        }
        if (simplified.includes("new Fraction(60).div(module.findTempo") && 
            !simplified.includes("module.baseNote.getVariable('startTime')")) {
            simplified = simplifyDurationExpression(simplified);
        }
        if (simplified.includes("module.baseNote.getVariable('startTime')")) {
            simplified = simplifyStartTimeExpression(simplified);
        }
        simplified = removeExcessParentheses(simplified);
        return simplified;
    } catch (error) {
        console.error("Error in simplifyExpressions:", error);
        return expr;
    }
}

function replaceNoteReferencesWithBaseNoteOnly(expr, moduleInstance) {
    const measureLengthRegex = /module\.findMeasureLength\(module\.getNoteById\((\d+)\)\)/g;
    const tempoRegex = /module\.findTempo\(module\.getNoteById\((\d+)\)\)/g;
    const draggedNotePattern = /module\.getNoteById\((\d+)\)\.getVariable\('startTime'\)\.add\(new Fraction\(60\)\.div\(module\.findTempo\(module\.getNoteById\(\d+\)\)\)\.mul\(new Fraction\(([^,]+),\s*([^)]+)\)\)\)/g;

    let prevExpr = '';
    let currentExpr = expr;
    let iterations = 0;
    const MAX_ITERATIONS = 10;

    while (prevExpr !== currentExpr && iterations < MAX_ITERATIONS) {
        prevExpr = currentExpr;
        iterations++;

        currentExpr = currentExpr.replace(measureLengthRegex, () => 'module.findMeasureLength(module.baseNote)');
        currentExpr = currentExpr.replace(tempoRegex, () => 'module.findTempo(module.baseNote)');

        currentExpr = currentExpr.replace(draggedNotePattern, (match, noteId, numerator, denominator) => {
            const refNote = moduleInstance.getNoteById(parseInt(noteId, 10));
            if (!refNote) return match;

            const refStartTime = refNote.getVariable('startTime').valueOf();
            const baseTempo = moduleInstance.baseNote.getVariable('tempo').valueOf();
            const beatLength = 60 / baseTempo;
            const beatOffset = new Fraction(numerator, denominator).valueOf();

            const absoluteTime = refStartTime + (beatOffset * beatLength);
            const baseStartTime = moduleInstance.baseNote.getVariable('startTime').valueOf();
            const offset = absoluteTime - baseStartTime;
            const offsetBeats = offset / beatLength;

            return `module.baseNote.getVariable('startTime').add(new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(${offsetBeats})))`;
        });

        const noteRefRegex = /module\.getNoteById\((\d+)\)\.getVariable\('([^']+)'\)/g;

        let newExpr = '';
        let lastIndex = 0;
        let match;

        const regex = new RegExp(noteRefRegex);
        while ((match = regex.exec(currentExpr)) !== null) {
            newExpr += currentExpr.substring(lastIndex, match.index);
            const noteId = match[1];
            const varName = match[2];

            if (noteId === '0') {
                newExpr += `module.baseNote.getVariable('${varName}')`;
            } else {
                const refNote = moduleInstance.getNoteById(parseInt(noteId, 10));
                if (!refNote) {
                    newExpr += match[0];
                } else {
                    const rawExpr = refNote.variables[varName + 'String'] || '';
                    if (!rawExpr) {
                        newExpr += match[0];
                    } else {
                        if (rawExpr === "module.baseNote.getVariable('startTime')") {
                            newExpr += `module.baseNote.getVariable('${varName}')`;
                        } else {
                            newExpr += `(${rawExpr})`;
                        }
                    }
                }
            }
            lastIndex = match.index + match[0].length;
        }
        newExpr += currentExpr.substring(lastIndex);
        if (newExpr !== currentExpr) currentExpr = newExpr;
    }
    currentExpr = currentExpr.replace(/module\.getNoteById\(0\)/g, 'module.baseNote');
    return simplifyExpressions(currentExpr);
}

// ===== Feature: Evaluate to BaseNote =====
export function evaluateNoteToBaseNote(noteId) {
    const note = getModule().getNoteById(parseInt(noteId, 10));
    if (!note) {
        console.error("Note not found:", noteId);
        return;
    }

    const variablesToProcess = ['startTime', 'duration', 'frequency'];
    let success = true;
    const MAX_ITERATIONS = 15;

    variablesToProcess.forEach(varName => {
        if (!note.variables[varName + 'String']) return;

        let currentRawExpr = note.variables[varName + 'String'];
        let newRawExpr = currentRawExpr;
        let iterations = 0;

        do {
            currentRawExpr = newRawExpr;
            if (currentRawExpr.indexOf("module.getNoteById(") === -1) break;
            newRawExpr = replaceNoteReferencesWithBaseNoteOnly(currentRawExpr, getModule());
            iterations++;
        } while (currentRawExpr !== newRawExpr && iterations < MAX_ITERATIONS);

        newRawExpr = removeExcessParentheses(newRawExpr);
        newRawExpr = balanceParentheses(newRawExpr);

        if (newRawExpr.indexOf("module.getNoteById(") !== -1) {
            try {
                const originalValue = note.getVariable(varName).valueOf();

                if (varName === 'startTime') {
                    newRawExpr = `module.baseNote.getVariable('startTime').add(new Fraction(${originalValue}))`;
                } else if (varName === 'duration') {
                    newRawExpr = `new Fraction(${originalValue})`;
                } else if (varName === 'frequency') {
                    const baseFreq = getModule().baseNote.getVariable('frequency').valueOf();
                    const ratio = originalValue / baseFreq;
                    newRawExpr = `new Fraction(${ratio}).mul(module.baseNote.getVariable('frequency'))`;
                }
            } catch (error) {
                console.error(`Error creating direct expression for ${varName}:`, error);
                return;
            }
        }

        try {
            const testFunc = new Function("module", "Fraction", "return " + newRawExpr + ";");
            const testResult = testFunc(getModule(), Fraction);
            const originalValue = note.getVariable(varName).valueOf();
            const newValue = testResult.valueOf();

            if (Math.abs(originalValue - newValue) > 0.0001) return;

            note.setVariable(varName, function() {
                return new Function("module", "Fraction", "return " + newRawExpr + ";")(getModule(), Fraction);
            });
            note.setVariable(varName + 'String', newRawExpr);
        } catch (error) {
            console.error(`Error evaluating ${varName} for note ${noteId}:`, error);
            success = false;
        }
    });

    // re-evaluate and update UI
    getModule().markNoteDirty(note.id);
    const evaluated = getModule().evaluateModule();
    setEvaluatedNotes(evaluated);
    if (typeof externalFunctions.updateVisualNotes === 'function') {
        externalFunctions.updateVisualNotes(evaluated);
    }

    const newElem = document.querySelector(`.note-content[data-note-id="${noteId}"]`);
    if (currentSelectedNote && currentSelectedNote.id !== 0 && newElem) {
        if (externalFunctions.bringSelectedNoteToFront) {
            externalFunctions.bringSelectedNoteToFront(currentSelectedNote, newElem);
        }
    }
    showNoteVariables(currentSelectedNote, newElem);

    try {
        const snap = getModule().createModuleJSON();
        eventBus.emit('history:capture', { label: `Evaluate Note ${noteId} to BaseNote`, snapshot: snap });
    } catch {}

    if (success) showNotification('Note evaluated successfully!', 'success');
}

// ===== Feature: Evaluate entire module =====
export function evaluateEntireModule() {
    const moduleInstance = getModule();
    const noteIds = Object.keys(moduleInstance.notes).map(id => parseInt(id, 10)).filter(id => id !== 0);
    noteIds.sort((a, b) => a - b);

    let successCount = 0;
    let skippedCount = 0;
    const failedNotes = [];

    for (const noteId of noteIds) {
        try {
            const note = moduleInstance.getNoteById(noteId);
            if (!note) continue;

            const isMeasureNote = note.variables.startTime && !note.variables.duration && !note.variables.frequency;
            const variablesToProcess = ['startTime', 'duration', 'frequency'];
            let noteSuccess = true;

            for (const varName of variablesToProcess) {
                if (!note.variables[varName + 'String']) continue;

                const originalExpr = note.variables[varName + 'String'];
                const originalValue = note.getVariable(varName).valueOf();

                if (originalExpr.indexOf("module.getNoteById(") === -1 &&
                    (originalExpr.indexOf("module.baseNote") !== -1 ||
                     originalExpr.indexOf("new Fraction") !== -1)) {
                    continue;
                }

                let newExpr;
                try {
                    newExpr = replaceNoteReferencesWithBaseNoteOnly(originalExpr, moduleInstance);
                    const testFunc = new Function("module", "Fraction", "return " + newExpr + ";");
                    const testResult = testFunc(moduleInstance, Fraction);

                    if (Math.abs(testResult.valueOf() - originalValue) < 0.0001) {
                        note.setVariable(varName, function() {
                            return new Function("module", "Fraction", "return " + newExpr + ";")(moduleInstance, Fraction);
                        });
                        note.setVariable(varName + 'String', newExpr);
                        noteSuccess = true;
                    } else {
                        // Fallback direct expression
                        const baseNote = moduleInstance.baseNote;
                        let directExpr;
                        if (varName === 'startTime') {
                            const baseStartTime = baseNote.getVariable('startTime').valueOf();
                            const offset = originalValue - baseStartTime;
                            const baseTempo = baseNote.getVariable('tempo').valueOf();
                            const beatLength = 60 / baseTempo;
                            const offsetBeats = offset / beatLength;
                            directExpr = `module.baseNote.getVariable('startTime').add(new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(${offsetBeats})))`;
                        } else if (varName === 'duration') {
                            const baseTempo = baseNote.getVariable('tempo').valueOf();
                            const beatLength = 60 / baseTempo;
                            const durationBeats = originalValue / beatLength;
                            directExpr = `new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(${durationBeats}))`;
                        } else if (varName === 'frequency') {
                            const baseFreq = baseNote.getVariable('frequency').valueOf();
                            const ratio = originalValue / baseFreq;
                            directExpr = `new Fraction(${ratio}).mul(module.baseNote.getVariable('frequency'))`;
                        }
                        const directFunc = new Function("module", "Fraction", "return " + directExpr + ";");
                        const directResult = directFunc(moduleInstance, Fraction);
                        if (Math.abs(directResult.valueOf() - originalValue) < 0.0001) {
                            note.setVariable(varName, function() {
                                return new Function("module", "Fraction", "return " + directExpr + ";")(moduleInstance, Fraction);
                            });
                            note.setVariable(varName + 'String', directExpr);
                            noteSuccess = true;
                        } else {
                            noteSuccess = false;
                            failedNotes.push({ noteId, varName, originalExpr, originalValue });
                        }
                    }
                } catch (error) {
                    console.error(`Error evaluating ${varName} for note ${noteId}:`, error);
                    noteSuccess = false;
                    failedNotes.push({ noteId, varName, originalExpr, originalValue, error: error.message });
                }
            }

            if (noteSuccess) {
                successCount++;
                moduleInstance.markNoteDirty(noteId);
            } else {
                skippedCount++;
            }
        } catch (error) {
            console.error(`Error evaluating note ${noteId}:`, error);
            skippedCount++;
            failedNotes.push({ noteId, error: error.message });
        }
    }

    const evaluated = moduleInstance.evaluateModule();
    setEvaluatedNotes(evaluated);
    if (typeof externalFunctions.updateVisualNotes === 'function') {
        externalFunctions.updateVisualNotes(evaluated);
    }

    try {
        const snap = getModule().createModuleJSON();
        eventBus.emit('history:capture', { label: 'Evaluate Module', snapshot: snap });
    } catch {}
    showNotification(`Module evaluation complete: ${successCount} notes processed, ${skippedCount} notes skipped`, 'success');
}

// ===== Feature: Liberate dependencies (replace references with raw values) =====
export function liberateDependencies(noteId) {
    const selectedNote = getModule().getNoteById(noteId);
    if (!selectedNote) return;

    const currentSelected = selectedNote;
    const isMeasureBar = selectedNote.variables.startTime && !selectedNote.variables.duration;

    if (isMeasureBar) {
        showNotification('Cannot liberate dependencies on measure bars', 'error');
        return;
    }

    let selectedRaw = {};
    ["startTime", "duration", "frequency"].forEach(varName => {
        if (selectedNote.variables[varName + "String"]) {
            selectedRaw[varName] = selectedNote.variables[varName + "String"];
        } else {
            const frac = selectedNote.getVariable(varName);
            let fracStr;
            if (frac == null) {
                fracStr = (varName === "frequency") ? "1/1" : "0/1";
            } else if (frac && typeof frac.toFraction === "function") {
                fracStr = frac.toFraction();
            } else {
                fracStr = frac.toString();
            }
            if (!fracStr.includes("/")) fracStr = fracStr + "/1";
            selectedRaw[varName] = "new Fraction(" + fracStr + ")";
        }
    });

    if (typeof externalFunctions.updateDependentRawExpressions === 'function') {
        externalFunctions.updateDependentRawExpressions(noteId, selectedRaw);
    }

    const dependents = getModule().getDependentNotes(noteId);
    dependents.forEach(depId => { getModule().markNoteDirty(depId); });

    const evaluated = getModule().evaluateModule();
    setEvaluatedNotes(evaluated);
    if (typeof externalFunctions.updateVisualNotes === 'function') {
        externalFunctions.updateVisualNotes(evaluated);
    }

    const newElem = document.querySelector(`.note-content[data-note-id="${noteId}"]`);
    if (currentSelected && currentSelected.id !== 0 && newElem) {
        if (externalFunctions.bringSelectedNoteToFront) {
            externalFunctions.bringSelectedNoteToFront(currentSelected, newElem);
        }
    }
    showNoteVariables(currentSelected, newElem);
    try {
        const snap = getModule().createModuleJSON();
        eventBus.emit('history:capture', { label: `Liberate Dependencies ${noteId}`, snapshot: snap });
    } catch {}
    showNotification('Dependencies liberated successfully!', 'success');
}

// ===== Confirmation dialogs =====
export function showLiberateConfirmation(noteId) {
    const overlay = document.createElement('div');
    overlay.className = 'delete-confirm-overlay';

    const modal = document.createElement('div');
    modal.className = 'delete-confirm-modal';

    const message = document.createElement('p');
    message.innerHTML = "Are you sure you want to <strong>LIBERATE</strong> all dependencies from Note[<span style='color:#00ccff'>"
        + noteId + "</span>]? This will replace all references to this note with raw values.";
    modal.appendChild(message);

    const btnContainer = document.createElement('div');
    btnContainer.className = 'modal-btn-container';

    const yesButton = document.createElement('button');
    yesButton.textContent = 'Yes';
    yesButton.style.backgroundColor = '#00ccff';
    yesButton.style.color = '#151525';
    yesButton.addEventListener('click', function(e) {
        e.stopPropagation();
        try { eventBus.emit('player:requestPause'); } catch {}
        liberateDependencies(noteId);
        document.body.removeChild(overlay);
    });

    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel';
    cancelButton.style.backgroundColor = '#add8e6';
    cancelButton.style.color = '#000';
    cancelButton.addEventListener('click', function(e) {
        e.stopPropagation();
        document.body.removeChild(overlay);
    });

    btnContainer.appendChild(yesButton);
    btnContainer.appendChild(cancelButton);
    modal.appendChild(btnContainer);
    overlay.appendChild(modal);

    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) {
            e.stopPropagation();
            document.body.removeChild(overlay);
        }
    });

    document.body.appendChild(overlay);
}

export function showEvaluateConfirmation(noteId) {
    const overlay = document.createElement('div');
    overlay.className = 'delete-confirm-overlay';

    const modal = document.createElement('div');
    modal.className = 'delete-confirm-modal';

    const message = document.createElement('p');
    message.innerHTML = "Are you sure you want to <strong>EVALUATE</strong> Note[<span style='color:#00ffff'>"
        + noteId + "</span>] to BaseNote? You will <span style='color:#00ffff'>lose all dependencies</span> to notes or measure bars.";
    modal.appendChild(message);

    const btnContainer = document.createElement('div');
    btnContainer.className = 'modal-btn-container';

    const yesButton = document.createElement('button');
    yesButton.textContent = 'Yes';
    yesButton.style.backgroundColor = '#00ffff';
    yesButton.style.color = '#151525';
    yesButton.addEventListener('click', function(e) {
        e.stopPropagation();
        try { eventBus.emit('player:requestPause'); } catch {}
        evaluateNoteToBaseNote(noteId);
        document.body.removeChild(overlay);
    });

    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel';
    cancelButton.style.backgroundColor = '#add8e6';
    cancelButton.style.color = '#000';
    cancelButton.addEventListener('click', function(e) {
        e.stopPropagation();
        document.body.removeChild(overlay);
    });

    btnContainer.appendChild(yesButton);
    btnContainer.appendChild(cancelButton);
    modal.appendChild(btnContainer);
    overlay.appendChild(modal);

    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) {
            e.stopPropagation();
            document.body.removeChild(overlay);
        }
    });

    document.body.appendChild(overlay);
}

export function showEvaluateModuleConfirmation() {
    const overlay = document.createElement('div');
    overlay.className = 'delete-confirm-overlay';

    const modal = document.createElement('div');
    modal.className = 'delete-confirm-modal';

    const message = document.createElement('p');
    message.innerHTML = "Are you sure you want to <strong>EVALUATE</strong> the entire module? This will simplify all notes to only have dependencies to the <span style='color:#00ffff'>BaseNote</span>.";
    modal.appendChild(message);

    const btnContainer = document.createElement('div');
    btnContainer.className = 'modal-btn-container';

    const yesButton = document.createElement('button');
    yesButton.textContent = 'Yes';
    yesButton.style.backgroundColor = '#00ffff';
    yesButton.style.color = '#151525';
    yesButton.addEventListener('click', function(e) {
        e.stopPropagation();
        try { eventBus.emit('player:requestPause'); } catch {}
        evaluateEntireModule();
        document.body.removeChild(overlay);
    });

    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel';
    cancelButton.style.backgroundColor = '#add8e6';
    cancelButton.style.color = '#000';
    cancelButton.addEventListener('click', function(e) {
        e.stopPropagation();
        document.body.removeChild(overlay);
    });

    btnContainer.appendChild(yesButton);
    btnContainer.appendChild(cancelButton);
    modal.appendChild(btnContainer);
    overlay.appendChild(modal);

    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) {
            e.stopPropagation();
            document.body.removeChild(overlay);
        }
    });

    document.body.appendChild(overlay);
}
export function init() {
    domCache.noteWidget = document.getElementById('note-widget');
    domCache.closeWidgetBtn = document.querySelector('.note-widget-close');
    domCache.widgetContent = document.querySelector('.note-widget-content');
    domCache.widgetTitle = document.getElementById('note-widget-title');

    domCache.closeWidgetBtn.addEventListener('click', () => {
        clearSelection();
    });

    window.addEventListener('resize', handleWindowResize);
    addDraggableNoteWidget();
    updateNoteWidgetHeight();
    try { eventBus.emit('modals:init'); } catch (e) {}
    // Accept refresh requests from other modules (to avoid window.modals usage)
    try {
        eventBus.on('modals:requestRefresh', ({ note, measureId, clickedElement }) => {
            showNoteVariables(note, clickedElement, measureId ?? null);
        });
    } catch {}
}

export const modals = {
    showNoteVariables,
    clearSelection,
    updateNoteWidgetHeight,
    showDeleteConfirmation,
    showDeleteConfirmationKeepDependencies,
    showCleanSlateConfirmation,
    // Evaluation and liberation APIs
    evaluateNoteToBaseNote,
    evaluateEntireModule,
    liberateDependencies,
    showLiberateConfirmation,
    showEvaluateConfirmation,
    showEvaluateModuleConfirmation,
    // Validation and cache
    validateExpression,
    invalidateDependencyGraphCache,
    // Wiring
    setExternalFunctions,
    init
};