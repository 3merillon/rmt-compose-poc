import Fraction from 'fraction.js';
import { createVariableControls } from './variable-controls.js';
import { createAddNoteSection, createAddMeasureSection } from './note-creation.js';
import { createEvaluateSection, createDeleteSection } from './note-actions.js';
import { 
    validateExpression, 
    detectCircularDependency,
    invalidateDependencyGraphCache 
} from './validation.js';

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
    
    if (note === window.myModule.baseNote) {
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
    
    if (note !== window.myModule.baseNote && effectiveNoteId !== undefined) {
        highlightDependencies(effectiveNoteId);
    }
    
    const variables = collectVariables(note, measureId);
    
    Object.entries(variables).forEach(([key, value]) => {
        const variableRow = createVariableControls(key, value, note, measureId, externalFunctions);
        widgetContent.appendChild(variableRow);
    });
    
    // Add creation sections
    const shouldShowAddMeasure = note === window.myModule.baseNote || 
        (measureId !== null && externalFunctions.isLastMeasureInChain(measureId));
    
    if (shouldShowAddMeasure) {
        const measureSection = createAddMeasureSection(note, measureId, externalFunctions);
        widgetContent.appendChild(measureSection);
    }

    if (note !== window.myModule.baseNote && !(measureId !== null)) {
        const noteSection = createAddNoteSection(note, false, externalFunctions);
        widgetContent.appendChild(noteSection);
    }

    if (note === window.myModule.baseNote) {
        const noteSection = createAddNoteSection(note, true, externalFunctions);
        widgetContent.appendChild(noteSection);
    }
    
    // Add evaluate section
    const evaluateSection = createEvaluateSection(note, measureId, effectiveNoteId);
    if (evaluateSection) {
        widgetContent.appendChild(evaluateSection);
    }
    
    // Add delete section
    const deleteSection = createDeleteSection(note, effectiveNoteId, externalFunctions);
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
    
    const directDeps = window.myModule.getDirectDependencies(selfNoteId).filter(depId => depId !== selfNoteId);
    const dependents = window.myModule.getDependentNotes(selfNoteId).filter(depId => depId !== selfNoteId);
    
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

function collectVariables(note, measureId) {
    let variables = {};
    
    if (note === window.myModule.baseNote) {
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
        const noteInstance = window.myModule.getNoteById(parseInt(measureId, 10));
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
        const inheritedInstrument = window.myModule.findInstrument(note);

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
        const note = window.myModule.getNoteById(parseInt(noteId, 10));
        if (note && externalFunctions.restoreNotePosition) {
          externalFunctions.restoreNotePosition(note);
        }
      });
      externalFunctions.originalNoteOrder.clear();
    }
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
        if (window.playerState?.isPlaying && !window.playerState.isPaused && window.playerControls?.pause) {
            window.playerControls.pause();
        }
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
        if (window.playerState?.isPlaying && !window.playerState.isPaused && window.playerControls?.pause) {
            window.playerControls.pause();
        }
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
        if (window.playerState?.isPlaying && !window.playerState.isPaused && window.playerControls?.pause) {
            window.playerControls.pause();
        }
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
}

export const modals = {
    showNoteVariables,
    clearSelection,
    updateNoteWidgetHeight,
    showDeleteConfirmation,
    showDeleteConfirmationKeepDependencies,
    showCleanSlateConfirmation,
    validateExpression,
    invalidateDependencyGraphCache,
    setExternalFunctions,
    init
};