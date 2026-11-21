import Fraction from 'fraction.js';
import { getDisplayTransposition, shownFrequency, moduleRepeatRatio } from '../player/display-transpose.js';
import { isRational, shadow as shadowOf, toText as exactText, toNumber as exactNumber } from '../value/exact.js';
import { createVariableControls, createMeasureDurationRow } from './variable-controls.js';
import { createAddNoteSection, createAddMeasureSection } from './note-creation.js';
import { createEvaluateSection, createDeleteSection, createSelectSection } from './note-actions.js';
import {
    validateExpression,
    detectCircularDependency,
    invalidateDependencyGraphCache
} from './validation.js';
import { eventBus } from '../utils/event-bus.js';
import { moduleSnapshot } from '../store/history.js';
import { getModule, setEvaluatedNotes } from '../store/app-state.js';
import { escapeHtml } from '../utils/html-escape.js';
import { startTimeExpr, timeUnitsExpr, frequencyExpr, amplitudeExpr, valueFactor } from '../utils/value-expr.js';
import { isMeasureNote, isReferenceNote } from '../note.js';
import { CORRUPT } from '../binary-note.js';
import { makeDraggableWidget, MIN_BUFFER, TOP_HEADER_HEIGHT } from '../utils/draggable-widget.js';
import { raisePanel } from '../utils/panel-stack.js';
import { viewportHeight } from '../utils/viewport.js';

const domCache = {
    noteWidget: null,
    closeWidgetBtn: null,
    widgetContent: null,
    widgetTitle: null
};

let currentSelectedNote = null;
let currentMeasureId = null;

// A freshly-opened note widget is a compact card. Its content (every variable, with its
// expression) is far taller than this and scrolls; the card only grows past 300px if the
// user drags it somewhere with room to fit more.
const DEFAULT_OPEN_HEIGHT = 300;

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
    cleanSlate: null,
    bringSelectedNoteToFront: null,
    restoreNotePosition: null,
    clearLastSelectedNote: null,
    originalNoteOrder: null,
    updateDependentRawExpressions: null,
    isLastMeasureInChain: null,
    selectRelatedNotes: null
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

    // A measure bar opened without its measure id (e.g. after Evaluate to BaseNote)
    // still gets the bar widget, not the one for a rest.
    if (measureId === null && isMeasureNote(note)) {
        measureId = note.id;
    }

    const effectiveNoteId = (note && note.id !== undefined) ? note.id : measureId;
    if (effectiveNoteId === undefined) {
        console.error("No valid note id found for dependency highlighting.");
        return;
    }
    
    const widgetContent = domCache.widgetContent;
    const widgetTitle = domCache.widgetTitle;

    // This function is both "open the widget on a note" and "rebuild the widget in place"
    // (an octave arrow, a saved variable, an added note, a changed arrow setting all come
    // back through here). A rebuild wipes the scroll container below, so remember where the
    // user was scrolled to when the note on screen is the one we are about to redraw.
    // Opening on a DIFFERENT note is a fresh card and starts at the top.
    const prevEffectiveId = currentSelectedNote
        ? ((currentSelectedNote.id !== undefined) ? currentSelectedNote.id : currentMeasureId)
        : undefined;
    const isRebuildOfSameNote =
        domCache.noteWidget.classList.contains('visible') &&
        prevEffectiveId !== undefined &&
        String(prevEffectiveId) === String(effectiveNoteId) &&
        (currentMeasureId ?? null) === (measureId ?? null);
    const preservedScrollTop = isRebuildOfSameNote ? widgetContent.scrollTop : 0;

    const isSilence = note && note.getVariable('startTime') &&
                     note.getVariable('duration') &&
                     !note.getVariable('frequency');
    const isReference = note && isReferenceNote(note);
    
    if (note === moduleInstance.baseNote) {
        widgetTitle.textContent = 'BaseNote Variables';
    } else if (measureId !== null) {
        widgetTitle.textContent = `Measure [${measureId}] Variables`;
    } else if (isSilence) {
        widgetTitle.textContent = `Silence [${effectiveNoteId || 'unknown'}] Variables`;
    } else if (isReference) {
        widgetTitle.textContent = `Reference [${effectiveNoteId || 'unknown'}] Variables`;
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
    
    const variables = collectVariables(note, measureId, moduleInstance);
    
    Object.entries(variables).forEach(([key, value]) => {
        const variableRow = createVariableControls(key, value, note, measureId, externalFunctions);
        widgetContent.appendChild(variableRow);
    });

    // The bar's length: its own duration, as an expression row
    if (measureId !== null) {
        const measureDurationRow = createMeasureDurationRow(note, measureId, externalFunctions);
        if (measureDurationRow) widgetContent.appendChild(measureDurationRow);
    }
    
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
    
    // Select this note's relations as a group
    const selectSection = createSelectSection(note, effectiveNoteId, externalFunctions);
    if (selectSection) {
        widgetContent.appendChild(selectSection);
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
    // Last opened wins: clicking a note with the settings panel (or the "+" menu)
    // parked over the widget must put the widget you just summoned in FRONT of it,
    // not behind it. Without this the widget only came forward once you touched it.
    raisePanel(domCache.noteWidget);
    updateNoteWidgetHeight();

    // After the height is settled, so the browser clamps against the final scroll range.
    if (preservedScrollTop > 0) {
        widgetContent.scrollTop = preservedScrollTop;
    }

    if (!clickedElement && note && note.id !== undefined) {
        const selElem = document.querySelector(`[data-note-id="${CSS.escape(String(note.id))}"]`);
        if (selElem) {
            selElem.classList.add("selected");
        }
    }
    
    currentSelectedNote = note;
    currentMeasureId = measureId;
    try { eventBus.emit('modals:show', { noteId: effectiveNoteId, isMeasure: measureId !== null }); } catch (e) {}
}

// Seed the Raw editor with a parseable exact form when no source string exists.
// Fraction toString() prints repeating decimals like '0.(3)', which won't re-parse;
// toFraction() gives 'n/d' which both expression formats accept.
function rawValueSeed(v) {
    return (v && typeof v.toFraction === 'function') ? v.toFraction() : String(v);
}

// The interpretation variables: how a note sounds, not what it relates to.
const INTERPRETATION_VARS = ['amplitude', 'attack', 'release'];
const INTERPRETATION_CORRUPT = {
    amplitude: CORRUPT.AMPLITUDE,
    attack: CORRUPT.ATTACK,
    release: CORRUPT.RELEASE
};

// The amplitude, attack and release rows. Unlike the other expression rows they
// are shown even when the note has none of its own — that is the only way to
// give it one. The value is then the one the note sounds with (the BaseNote's;
// else 1 for amplitude, else the instrument's own envelope for attack and
// release), flagged as inherited or default, and Raw is empty. A silence has
// nothing to sound, so it only gets a row for a variable it carries anyway
// (hand-written JSON).
function collectInterpretation(note, module, depGraph, name) {
    const isBase = note === module.baseNote;
    const hasOwn = note.hasExpression(name);
    if (!isBase && !hasOwn && !note.getVariable('frequency')) return null;
    // A reference (a frequency, no duration) never sounds: nothing to interpret.
    if (!isBase && !hasOwn && isReferenceNote(note)) return null;

    // ≈ follows whichever note's expression produced the value.
    const sourceId = hasOwn ? note.id : 0;
    const isCorrupted = !!(depGraph && typeof depGraph.isPropertyCorrupted === 'function'
        && depGraph.isPropertyCorrupted(sourceId, INTERPRETATION_CORRUPT[name]));

    const evaluated = (name === 'amplitude')
        ? module.findAmplitude(note)
        : (hasOwn ? note.getVariable(name) : module.baseNote.getVariable(name));
    // Attack or release defined nowhere: the instrument's own envelope applies.
    const isDefault = name !== 'amplitude' && evaluated == null;

    return {
        evaluated,
        raw: hasOwn ? (note.variables[name + 'String'] || '') : '',
        isInherited: !hasOwn && !isBase && !isDefault,
        isDefault,
        isCorrupted: !isDefault && isCorrupted
    };
}

function collectVariables(note, measureId, moduleInstance) {
    let variables = {};
    const module = moduleInstance || (typeof getModule === 'function' ? getModule() : null);
    if (!module || !module.baseNote) {
        return variables;
    }

    // Get corruption status from dependency graph
    const depGraph = typeof module.getDependencyGraph === 'function' ? module.getDependencyGraph() : null;
    const noteId = note?.id ?? (measureId !== null ? parseInt(measureId, 10) : null);
    const isNoteCorrupted = depGraph && noteId !== null && typeof depGraph.isNoteCorrupted === 'function'
        ? depGraph.isNoteCorrupted(noteId)
        : false;

    // Property-specific corruption flags (for per-variable corruption display)
    // Bit flags: 0x01=startTime, 0x02=duration, 0x04=frequency
    const corruptionFlags = depGraph && noteId !== null && typeof depGraph.getCorruptionFlags === 'function'
        ? depGraph.getCorruptionFlags(noteId)
        : 0;

    if (note === module.baseNote) {
        let interpretationPlaced = false;
        const placeInterpretation = () => {
            if (interpretationPlaced) return;
            interpretationPlaced = true;
            for (const name of INTERPRETATION_VARS) {
                const entry = collectInterpretation(note, module, depGraph, name);
                if (entry) variables[name] = entry;
            }
        };

        Object.keys(note.variables).forEach(key => {
            // amplitude, attack and release get their rows whether or not the BaseNote defines them
            const baseKey = key.endsWith('String') ? key.slice(0, -6) : key;
            if (INTERPRETATION_VARS.includes(baseKey)) return;
            if (key === 'color' || key === 'instrument') placeInterpretation();
            if (!key.endsWith('String')) {
                variables[key] = {
                    evaluated: note.getVariable(key),
                    raw: note.variables[key + 'String'] || rawValueSeed(note.variables[key]),
                    isCorrupted: false // BaseNote is never corrupted
                };
            }
        });
        placeInterpretation();

        if (!variables.instrument) {
            const hasOwnInstrument = note.properties.instrument != null;
            const resolvedInstrument = hasOwnInstrument
                ? note.getVariable('instrument')
                : module.findInstrument(note);
            variables.instrument = {
                evaluated: resolvedInstrument,
                raw: resolvedInstrument,
                isInherited: !hasOwnInstrument,
                isCorrupted: false
            };
        }
    } else if (measureId !== null) {
        const noteInstance = module.getNoteById(parseInt(measureId, 10));
        if (noteInstance && typeof noteInstance.getVariable === 'function') {
            variables.startTime = {
                evaluated: noteInstance.getVariable('startTime'),
                raw: noteInstance.variables.startTimeString || "undefined",
                isCorrupted: (corruptionFlags & 0x01) !== 0
            };
        } else {
            console.error("Invalid measure note:", noteInstance);
        }
    } else {
        const variableNames = ['startTime', 'duration', 'frequency', ...INTERPRETATION_VARS, 'color'];
        // Map variable names to their corruption flag bits
        const flagMap = { startTime: CORRUPT.START_TIME, duration: CORRUPT.DURATION, frequency: CORRUPT.FREQUENCY };

        // Check if frequency is transitively corrupted (for display purposes only)
        const freqTransitivelyCorrupted = depGraph && noteId !== null
            && typeof depGraph.isFrequencyTransitivelyCorrupted === 'function'
            && depGraph.isFrequencyTransitivelyCorrupted(noteId);

        variableNames.forEach(key => {
            if (INTERPRETATION_VARS.includes(key)) {
                const entry = collectInterpretation(note, module, depGraph, key);
                if (entry) variables[key] = entry;
                return;
            }
            if (note.variables && note.variables[key] !== undefined) {
                const propertyCorrupted = (corruptionFlags & (flagMap[key] || 0)) !== 0;

                if (key === 'color') {
                    const value = note.getVariable(key);
                    variables[key] = { evaluated: value, raw: value, isCorrupted: false };
                } else {
                    variables[key] = {
                        evaluated: note.getVariable(key),
                        raw: note.variables[key + 'String'] || rawValueSeed(note.variables[key]),
                        isCorrupted: propertyCorrupted,
                        // For frequency, flag if transitively corrupted (for display purposes)
                        isTransitivelyCorrupted: key === 'frequency' && freqTransitivelyCorrupted
                    };
                }
            }
        });

        const hasOwnInstrument = note.properties.instrument != null;
        const inheritedInstrument = module.findInstrument(note);
        // The first note of its line: the one whose instrument it plays with.
        let playerHead = null;
        try { playerHead = module.findPlayer ? module.findPlayer(note).head : null; } catch {}

        // A reference never sounds: no instrument row unless it carries one anyway.
        if (!hasOwnInstrument && isReferenceNote(note)) return variables;
        variables.instrument = {
            evaluated: hasOwnInstrument ? note.getVariable('instrument') : inheritedInstrument,
            raw: hasOwnInstrument ? note.getVariable('instrument') : inheritedInstrument,
            isInherited: !hasOwnInstrument,
            isCorrupted: false,
            playerHead: (playerHead != null && playerHead !== note.id) ? playerHead : null
        };
    }

    // The BaseNote's REPEAT row: the frequency it takes on the next repeat of a loop
    // (display-transpose.js), shown as the ratio from one pass to the next.
    if (note && note === module.baseNote) {
        let rr = null;
        try { rr = moduleRepeatRatio(module); } catch {}
        const cents = (v) => (1200 * Math.log2(exactNumber(v))).toFixed(1);
        variables.repeat = {
            evaluated: rr ? `${exactText(rr)} each repeat (${cents(rr)}¢)` : 'none: repeats as written',
            raw: note.properties.repeat || '',
            isCorrupted: !!(rr && !isRational(rr)),
            isRepeat: true
        };
    }

    // The exact value of each evaluated row (src/value/exact.js), for the
    // display: an irrational value is shown in its exact form, ≈ only marks an
    // approximation.
    const owner = note || (measureId !== null ? module.getNoteById(parseInt(measureId, 10)) : null);
    if (owner && typeof owner.getExactVariable === 'function') {
        for (const name of ['startTime', 'duration', 'frequency', 'amplitude', 'attack', 'release']) {
            const row = variables[name];
            if (!row || row.isDefault) continue;
            const from = (row.isInherited && owner !== module.baseNote) ? module.baseNote : owner;
            try { row.exact = from.getExactVariable(name); } catch { /* display only */ }
        }
    }

    // A transposed loop pass (display-transpose.js): frequencies show the pass being
    // heard, the written value times its factor, exact. The module is not touched.
    const shown = getDisplayTransposition();
    if (shown.factor && variables.frequency && !variables.frequency.isDefault) {
        const row = variables.frequency;
        try {
            const base = row.exact != null ? row.exact : row.evaluated;
            if (base != null) {
                const v = shownFrequency(base);
                row.exact = v;
                row.evaluated = isRational(v) ? v : shadowOf(v);
                row.transposedPass = shown.pass;
            }
        } catch { /* display only */ }
    }

    return variables;
}

export function clearSelection() {
    if (externalFunctions.clearLastSelectedNote) {
      externalFunctions.clearLastSelectedNote();
    }

    domCache.noteWidget.classList.remove('visible');
    currentSelectedNote = null;
    currentMeasureId = null;
    
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
    const PADDING = 5;

    // Measure the CONTENT — not the box we last gave it.
    //
    // The last line of this function writes an inline height onto `content`, and
    // `scrollHeight` can never report less than the box an element already has. So the
    // measurement could only ever GROW: show the BaseNote (a long variable list, capped
    // at DEFAULT_OPEN_HEIGHT), then click a Measure (one `startTime` row), and the
    // widget re-measured the tall box it had just been given itself and kept it — a
    // single row of content with dead space under it. Clearing the inline height first
    // lets the element report what it actually needs. Nothing paints between here and
    // the write below, so this is a measurement, not a flicker.
    content.style.height = '';
    const widgetDesiredHeight = headerHeight + content.scrollHeight + PADDING;

    // Until it is first dragged the widget is bottom-anchored (`bottom: 19px`) and has
    // no inline top, so it GROWS UPWARD. That distinction is the whole of this function.
    const dragged = !!widget.style.top;

    // The room to fit into.
    //
    // Bottom-anchored: the band between the top bar and the bottom edge. It must NOT be
    // derived from rect.top — for a bottom-anchored box rect.top is a function of the
    // height we are trying to compute, so `viewportHeight() - rect.top - MIN_BUFFER` is
    // just the height it already had. That self-reference is why the widget used to open
    // at whatever size it was last given, including the size computed at boot while it
    // was still display:none — and why touching it (which writes an inline top, breaking
    // the self-reference) snapped it to the right size.
    //
    // Dragged: a real measurement — whatever is below where the user parked it.
    const room = dragged
        ? viewportHeight() - rect.top - MIN_BUFFER
        : viewportHeight() - TOP_HEADER_HEIGHT - 2 * MIN_BUFFER;

    // A freshly-opened widget is a compact card, not a full-height panel: the variable
    // list is long and scrolls. Once dragged, it fits its content instead.
    const desired = dragged
        ? widgetDesiredHeight
        : Math.min(widgetDesiredHeight, DEFAULT_OPEN_HEIGHT);

    let effectiveHeight = Math.max(headerHeight, Math.min(room, desired));
    widget.style.height = effectiveHeight + "px";

    // Now check what we actually GOT. A position:fixed box is anchored to the layout
    // viewport — the real visible area — even in the frames after boot where a mobile
    // browser is still reporting a stale window.innerHeight. So don't trust the number
    // we just did arithmetic on: measure the box, and hand back any overshoot that
    // pushed the header off the top of the screen.
    if (!dragged) {
        const overshoot = (TOP_HEADER_HEIGHT + MIN_BUFFER) - widget.getBoundingClientRect().top;
        if (overshoot > 0.5) {
            effectiveHeight = Math.max(headerHeight, effectiveHeight - overshoot);
            widget.style.height = effectiveHeight + "px";
        }
    }

    const contentHeight = effectiveHeight - headerHeight - PADDING;
    content.style.height = Math.max(40, contentHeight) + "px";
    content.style.overflowY = "auto";
}

function addDraggableNoteWidget() {
    const widget = domCache.noteWidget;
    if (!widget) return;
    const header = widget.querySelector('.note-widget-header');
    if (!header) return;

    makeDraggableWidget({
        el: widget,
        handle: header,
        onMove: updateNoteWidgetHeight,
        isVisible: () => widget.classList.contains('visible'),
        ignoreDragStart: (e) => e.target.classList.contains('note-widget-close'),
    });
}

export function showDeleteConfirmation(noteId) {
    const overlay = document.createElement('div');
    overlay.className = 'delete-confirm-overlay';

    const modal = document.createElement('div');
    modal.className = 'delete-confirm-modal';

    const message = document.createElement('p');
    // SECURITY: Escape noteId to prevent XSS
    message.innerHTML = "Are you sure you want to <strong>DELETE</strong> Note[<span class='modal-note-id'>"
        + escapeHtml(noteId) + "</span>] and <span class='modal-delete-all'>DELETE ALL</span> its Dependencies (the notes linked to it by dependency lines in the workspace)?";
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
    // SECURITY: Escape noteId to prevent XSS
    message.innerHTML = "Are you sure you want to <strong>DELETE</strong> Note[<span class='modal-note-id'>"
       + escapeHtml(noteId) + "</span>] and <span class='modal-keep'>KEEP</span> its Dependencies? Dependent notes will update their references using this note's raw values.";
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
    message.innerHTML = "Are you sure you want to <span class='modal-delete-all'>DELETE ALL</span> notes except the base note? You can undo this with Ctrl/Cmd+Z.";
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
        Object.assign(notification.style, { backgroundColor: 'rgba(var(--rmt-danger-rgb), 0.8)', color: '#fff' });
    } else {
        Object.assign(notification.style, { backgroundColor: 'rgba(var(--rmt-accent-rgb), 0.8)', color: '#000' });
    }
    document.body.appendChild(notification);
    setTimeout(() => {
        notification.style.opacity = '0';
        setTimeout(() => { if (notification.parentNode) document.body.removeChild(notification); }, 300);
    }, 3000);
}


// ===== Feature: Evaluate to BaseNote =====
// The expression of a note's variable relative to the BaseNote, written from its
// exact value (src/utils/value-expr.js): a tempered pitch stays the power it is,
// `base.f * 2^(7/12)`. null when the value cannot be written exactly (an
// approximation): the note then keeps the expression it has.
function baseRelativeExpr(note, varName, moduleInstance) {
    const v = note.getExactVariable(varName);
    if (v == null) return null;
    const base = moduleInstance.baseNote;
    switch (varName) {
        case 'startTime':
            return startTimeExpr(v, base.getExactVariable('startTime'), base.getExactVariable('duration'));
        case 'duration':
            return timeUnitsExpr(v, base.getExactVariable('duration'));
        case 'frequency':
            return frequencyExpr(v, base.getExactVariable('frequency'));
        case 'amplitude': {
            // base.a is the piece-wide gain, so the note is written as a ratio of
            // it and goes on following it (1 when the BaseNote sets none)
            const baseA = base.hasExpression('amplitude') ? base.getExactVariable('amplitude') : moduleInstance.findAmplitude(base);
            return amplitudeExpr(v, baseA);
        }
        default:
            return null;
    }
}

export function evaluateNoteToBaseNote(noteId) {
    const moduleInstance = getModule();
    const note = moduleInstance.getNoteById(parseInt(noteId, 10));
    if (!note) {
        console.error("Note not found:", noteId);
        return;
    }

    // A measure bar has a start and a length (its duration), nothing that sounds
    const variablesToProcess = isMeasureNote(note)
        ? ['startTime', 'duration']
        : ['startTime', 'duration', 'frequency', 'amplitude'];
    let success = true;

    // Every value is read before any expression changes
    const newExprs = [];
    for (const varName of variablesToProcess) {
        if (!note.variables[varName + 'String']) continue;
        const newExpr = baseRelativeExpr(note, varName, moduleInstance);
        if (newExpr) newExprs.push([varName, newExpr]);
    }
    for (const [varName, newExpr] of newExprs) {
        note.setVariable(varName + 'String', newExpr);
    }

    // re-evaluate and update UI
    moduleInstance.markNoteDirty(note.id);
    const evaluated = moduleInstance.evaluateModule();
    setEvaluatedNotes(evaluated);
    if (typeof externalFunctions.updateVisualNotes === 'function') {
        externalFunctions.updateVisualNotes(evaluated);
    }

    const newElem = document.querySelector(`.note-content[data-note-id="${CSS.escape(String(noteId))}"]`);
    if (note && note.id !== 0 && newElem) {
        if (externalFunctions.bringSelectedNoteToFront) {
            externalFunctions.bringSelectedNoteToFront(note, newElem);
        }
    }
    // Use the note we just updated to ensure the UI shows fresh expression data
    showNoteVariables(note, newElem);

    try {
        const snap = moduleSnapshot(moduleInstance);
        eventBus.emit('history:capture', { label: `Evaluate Note ${noteId} to BaseNote`, ...snap });
    } catch {}

    if (success) showNotification('Note evaluated successfully!', 'success');
}

// ===== Feature: Evaluate entire module =====
// Optimized version using batch operations to avoid per-note overhead
export function evaluateEntireModule() {
    const moduleInstance = getModule();
    const noteIds = Object.keys(moduleInstance.notes).map(id => parseInt(id, 10)).filter(id => id !== 0);

    // Collect all expression updates in a single pass. Every value is read
    // before any update is applied, and all offset/ratio algebra stays exact.
    const updates = [];

    for (const noteId of noteIds) {
        const note = moduleInstance.getNoteById(noteId);
        if (!note) continue;

        // A measure bar has a start and a length (its duration), nothing that sounds
        const names = isMeasureNote(note)
            ? ['startTime', 'duration']
            : ['startTime', 'duration', 'frequency', 'amplitude'];
        for (const varName of names) {
            if (!note.hasExpression(varName)) continue;
            const expr = baseRelativeExpr(note, varName, moduleInstance);
            if (expr) updates.push({ noteId, varName, expr });
        }
    }

    // Apply all updates in a single batch operation (bypasses per-note notifications)
    moduleInstance.batchSetExpressions(updates);

    // Single evaluation pass at the end
    const evaluated = moduleInstance.evaluateModule();
    setEvaluatedNotes(evaluated);

    if (typeof externalFunctions.updateVisualNotes === 'function') {
        externalFunctions.updateVisualNotes(evaluated);
    }

    try {
        const snap = moduleSnapshot(moduleInstance);
        eventBus.emit('history:capture', { label: 'Evaluate Module', ...snap });
    } catch {}

    // Refresh the variable editor if a note is currently selected
    if (currentSelectedNote) {
        const escapedSelId = CSS.escape(String(currentSelectedNote.id));
        const selectedElem = document.querySelector(`.note-content[data-note-id="${escapedSelId}"], .base-note-circle[data-note-id="${escapedSelId}"]`);
        showNoteVariables(currentSelectedNote, selectedElem);
    }

    const noteCount = noteIds.length;
    showNotification(`Module evaluation complete: ${noteCount} notes converted to BaseNote references`, 'success');
}

// ===== Feature: Liberate dependencies (replace references with raw values) =====
export function liberateDependencies(noteId) {
    const selectedNote = getModule().getNoteById(noteId);
    if (!selectedNote) return;

    const currentSelected = selectedNote;

    if (isMeasureNote(selectedNote)) {
        showNotification('Cannot liberate dependencies on measure bars', 'error');
        return;
    }

    let selectedRaw = {};
    ["startTime", "duration", "frequency"].forEach(varName => {
        if (selectedNote.variables[varName + "String"]) {
            selectedRaw[varName] = selectedNote.variables[varName + "String"];
        } else {
            // The exact value: an irrational one exactly, an approximate one with ~
            const exact = selectedNote.getExactVariable(varName);
            selectedRaw[varName] = (exact == null)
                ? ((varName === "frequency") ? "1" : "0")
                : valueFactor(exact);
        }
    });
    // amplitude, attack and release only when the note defines its own; left
    // undefined, references to them are replaced by the BaseNote's (what the
    // note was inheriting).
    for (const varName of INTERPRETATION_VARS) {
        const own = selectedNote.variables[varName + "String"];
        if (own) selectedRaw[varName] = own;
    }

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

    const newElem = document.querySelector(`.note-content[data-note-id="${CSS.escape(String(noteId))}"]`);
    if (currentSelected && currentSelected.id !== 0 && newElem) {
        if (externalFunctions.bringSelectedNoteToFront) {
            externalFunctions.bringSelectedNoteToFront(currentSelected, newElem);
        }
    }
    showNoteVariables(currentSelected, newElem);
    try {
        const snap = moduleSnapshot(getModule());
        eventBus.emit('history:capture', { label: `Liberate Dependencies ${noteId}`, ...snap });
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
    // SECURITY: Escape noteId to prevent XSS
    message.innerHTML = "Are you sure you want to <strong>LIBERATE</strong> all dependencies from Note[<span style='color:#00ccff'>"
        + escapeHtml(noteId) + "</span>]? This will replace all references to this note with raw values.";
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
    // SECURITY: Escape noteId to prevent XSS
    message.innerHTML = "Are you sure you want to <strong>EVALUATE</strong> Note[<span style='color:#00ffff'>"
        + escapeHtml(noteId) + "</span>] to BaseNote? You will <span style='color:#00ffff'>lose all dependencies</span> to notes or measure bars.";
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

    addDraggableNoteWidget(); // also registers the resize re-clamp
    updateNoteWidgetHeight();
    try { eventBus.emit('modals:init'); } catch (e) {}
    // Accept refresh requests from other modules (to avoid window.modals usage)
    try {
        eventBus.on('modals:requestRefresh', ({ note, measureId, clickedElement }) => {
            showNoteVariables(note, clickedElement, measureId ?? null);
        });
        // A transposed loop moved to another pass: the open widget shows its values.
        eventBus.on('display:transposition', () => {
            if (!currentSelectedNote || !domCache.noteWidget || !domCache.noteWidget.classList.contains('visible')) return;
            try { showNoteVariables(currentSelectedNote, null, currentMeasureId ?? null); } catch {}
        });
    } catch {}
    // The widget bakes its ▲/▼ octave buttons (and their ratio tooltips) from the
    // arrow settings when it is built. The settings panel is non-modal now, so
    // those settings can change while the widget is open — rebuild it rather than
    // leave buttons that disagree with the workspace.
    try {
        eventBus.on('settings:changed', ({ path }) => {
            const p = String(path ?? '');
            if (p !== '' && p !== 'arrows' && !p.startsWith('arrows.')) return;
            if (!currentSelectedNote) return;
            if (!domCache.noteWidget || !domCache.noteWidget.classList.contains('visible')) return;
            showNoteVariables(currentSelectedNote, null, currentMeasureId);
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