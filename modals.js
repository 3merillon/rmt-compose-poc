/*
Custom Reference-Only License
Copyright (c) 2025 Cyril Monkewitz
All rights reserved.
This software and associated documentation files (the "Software") are provided for reference and
educational purposes only. Permission is explicitly NOT granted to:
Use the Software for commercial purposes
Modify the Software
Distribute the Software
Sublicense the Software
Use the Software in any production environment
The above copyright notice and this permission notice shall be included in all copies or substantial
portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE
OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
For licensing inquiries or commercial use, please contact: cyril.monkewitz@gmail.com
*/

// Modals Module
(function() {
    // DOM Cache for modal elements
    const domCache = {
        noteWidget: document.getElementById('note-widget'),
        closeWidgetBtn: document.querySelector('.note-widget-close'),
        widgetContent: document.querySelector('.note-widget-content'),
        widgetTitle: document.getElementById('note-widget-title')
    };

    // Modal state
    let currentSelectedNote = null;
    let widgetInitiallyOpened = false;
    const TOP_HEADER_HEIGHT = 50;
    const MIN_BUFFER = 20;

    // References to external functions (will be set by init)
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
        cleanSlate: null
    };

    // Function to efficiently apply class changes to elements
    function batchClassOperation(elements, classesToAdd = [], classesToRemove = []) {
        if (!elements || elements.length === 0) return;
        
        // Process in batches to avoid layout thrashing
        const BATCH_SIZE = 50;
        const total = elements.length;
        
        for (let i = 0; i < total; i += BATCH_SIZE) {
            const batch = Array.from(elements).slice(i, i + BATCH_SIZE);
            
            // Use requestAnimationFrame to batch DOM updates
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

    // Function to efficiently clear all highlights
    function clearAllHighlights() {
        const highlightedElements = document.querySelectorAll('.dependency, .dependent');
        batchClassOperation(highlightedElements, [], ['dependency', 'dependent']);
    }

    // Function to debounce calls
    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            const context = this;
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(context, args), wait);
        };
    }

    // Show note variables in the widget
    function showNoteVariables(note, clickedElement, measureId = null) {
        const effectiveNoteId = (note && note.id !== undefined) ? note.id : measureId;
        if (effectiveNoteId === undefined) {
            console.error("No valid note id found for dependency highlighting.");
            return;
        }
        
        // Cache DOM elements for this function
        const widgetContent = domCache.widgetContent;
        const widgetTitle = domCache.widgetTitle;
        
        if (note === window.myModule.baseNote) {
            widgetTitle.textContent = 'BaseNote Variables';
        } else if (measureId !== null) {
            widgetTitle.textContent = `Measure [${measureId}] Variables`;
        } else {
            widgetTitle.textContent = `Note [${effectiveNoteId || 'unknown'}] Variables`;
        }
        
        widgetContent.innerHTML = '';
        
        // Clear only the selection highlight, keep dependency and dependent classes
        const selectedElements = document.querySelectorAll('.note-content.selected, .base-note-circle.selected, .measure-bar-triangle.selected');
        selectedElements.forEach(el => {
            // Only remove 'selected' if this element's note id is different from the current note's id
            if (el.getAttribute('data-note-id') !== String(note.id)) {
                el.classList.remove('selected');
            }
        });
        
        // Clear previous dependency highlights
        document.querySelectorAll('.dependency, .dependent').forEach(el => {
            el.classList.remove('dependency', 'dependent');
        });
        
        if (clickedElement) {
            clickedElement.classList.add('selected');
        }
        
        // OPTIMIZATION: Only highlight dependencies if the note isn't the base note and has a valid ID
        if (note !== window.myModule.baseNote && effectiveNoteId !== undefined) {
            const selfNoteId = effectiveNoteId;
            
            // Create a map for faster lookups
            const elementMap = new Map();
            
            // Use a single query to get all elements we might need to highlight
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
            
            // Get dependencies and dependents in a single pass
            const directDeps = window.myModule.getDirectDependencies(selfNoteId).filter(depId => depId !== selfNoteId);
            const dependents = window.myModule.getDependentNotes(selfNoteId).filter(depId => depId !== selfNoteId);
            
            // Highlight dependencies using the map
            directDeps.forEach(depId => {
                const elements = elementMap.get(String(depId));
                if (elements) {
                    elements.forEach(el => el.classList.add('dependency'));
                }
            });
            
            // Highlight dependents using the map
            dependents.forEach(depId => {
                const elements = elementMap.get(String(depId));
                if (elements) {
                    elements.forEach(el => el.classList.add('dependent'));
                }
            });
        }
        
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
                        const colorValue = note.getVariable(key);
                        variables[key] = { evaluated: colorValue, raw: colorValue };
                    } else {
                        variables[key] = {
                            evaluated: note.getVariable(key),
                            raw: note.variables[key + 'String'] || note.variables[key].toString()
                        };
                    }
                }
            });
        }
        
        // Build the widget rows for each variable.
        Object.entries(variables).forEach(([key, value]) => {
            const variableRow = document.createElement('div');
            variableRow.className = 'variable-row';
            
            const variableNameDiv = document.createElement('div');
            variableNameDiv.className = 'variable-name';
            variableNameDiv.textContent = key;
            
            const variableValueDiv = document.createElement('div');
            variableValueDiv.className = 'variable-value';
            
            const evaluatedDiv = document.createElement('div');
            evaluatedDiv.className = 'evaluated-value';
            evaluatedDiv.innerHTML = `<span class="value-label">Evaluated:</span> ${value.evaluated !== null ? String(value.evaluated) : 'null'}`;
            
            const rawDiv = document.createElement('div');
            rawDiv.className = 'raw-value';
            
            // For the duration variable, add beat modification buttons.
            if (key === 'duration') {
                const durationPicks = document.createElement('div');
                durationPicks.className = 'duration-picks';
                // Use a flex container to space left (base buttons) and right (dot buttons)
                durationPicks.style.display = 'flex';
                durationPicks.style.justifyContent = 'space-between';
                durationPicks.style.alignItems = 'center';
                
                // Left container: base note buttons
                const leftContainer = document.createElement('div');
                leftContainer.style.display = 'flex';
                leftContainer.style.gap = '4px';
                
                // Right container: dot modifier buttons
                const rightContainer = document.createElement('div');
                rightContainer.style.display = 'flex';
                rightContainer.style.gap = '4px';
                
                // Define the five base pick choices
                const basePicks = [
                    { base: 4, symbol: '𝅝' },
                    { base: 2, symbol: '𝅗𝅥' },
                    { base: 1, symbol: '𝅘𝅥' },
                    { base: 0.5, symbol: '𝅘𝅥𝅮' },
                    { base: 0.25, symbol: '𝅘𝅥𝅯' }
                ];
                
                // Define the dot modifier options (we want only two buttons: one for a dot and one for double dot)
                const dotPicks = [
                    { mod: 'dot', factor: 1.5, label: '.' },
                    { mod: 'double', factor: 1.75, label: '..' }
                ];
                
                // Determine the default selection by extracting the current multiplier
                let selectedBase = null;
                let selectedMod = 1; // default multiplier (i.e. no dot)
                let currentMultiplier = null;
                let regex = /^new Fraction\(60\)\.div\((.*?)\)\.mul\((.*?)\)$/;
                let m = value.raw.match(regex);
                if (m && m[2]) {
                    currentMultiplier = parseFloat(m[2]);
                } else {
                    // If no multiplication is found, assume the default multiplier is 1 (representing a quarter note).
                    currentMultiplier = 1;
                }
                // Check all base x mod combinations:
                // First check no–dot case, then dot cases.
                basePicks.forEach(bp => {
                    if (currentMultiplier !== null && Math.abs(currentMultiplier - (bp.base * 1)) < 0.001) {
                        selectedBase = bp.base;
                        selectedMod = 1;
                    }
                    dotPicks.forEach(dp => {
                        if (currentMultiplier !== null && Math.abs(currentMultiplier - (bp.base * dp.factor)) < 0.001) {
                            selectedBase = bp.base;
                            selectedMod = dp.factor;
                        }
                    });
                });
                
                // Create base note buttons (left side) with updated styles.
                basePicks.forEach(bp => {
                    const btn = document.createElement('button');
                    const imageFile = getDurationImageForBase(bp.base);
                    btn.innerHTML = `<img src="images/${imageFile}" style="width:18px; height:18px;">`;
                    btn.style.width = "26px";
                    btn.style.height = "26px";
                    btn.style.padding = "0";
                    btn.style.backgroundColor = "#444";
                    btn.style.border = "1px solid orange";
                    btn.style.borderRadius = "4px";
                    btn.style.cursor = "pointer";
                    btn.style.overflow = "hidden";
                    btn.style.display = "flex";
                    btn.style.justifyContent = "center";
                    btn.style.alignItems = "center";
                    
                    // Highlight the base button if bp.base matches the selected base (regardless of modifier)
                    if (selectedBase !== null && Math.abs(bp.base - selectedBase) < 0.001) {
                        btn.style.backgroundColor = "#ff0000";
                    }
                    
                    btn.addEventListener('click', () => {
                        selectedBase = bp.base;
                        let originalExpr = value.raw;
                        let regex = /^new Fraction\(60\)\.div\((.*?)\)\.mul\((.*?)\)$/;
                        let newExpr;
                        let match = originalExpr.match(regex);
                        if (match) {
                            newExpr = `new Fraction(60).div(${match[1]}).mul(${selectedBase * selectedMod})`;
                        } else {
                            newExpr = `new Fraction(60).div(module.findTempo(module.baseNote)).mul(${selectedBase * selectedMod})`;
                        }
                        rawInput.value = newExpr;
                        saveButton.style.display = 'inline-block';
                        // Update highlighting for all base buttons.
                        Array.from(leftContainer.children).forEach(child => {
                            child.style.backgroundColor = "#444";
                        });
                        btn.style.backgroundColor = "#ff0000";
                    });
                    leftContainer.appendChild(btn);
                });
                
                // Create dot modifier buttons (right side) with toggle behavior.
                dotPicks.forEach(dp => {
                    const btn = document.createElement('button');
                    btn.textContent = dp.label;
                    btn.style.width = "26px";
                    btn.style.height = "26px";
                    btn.style.padding = "0";
                    btn.style.fontSize = "14px";
                    btn.style.lineHeight = "26px";
                    btn.style.backgroundColor = "#444";
                    btn.style.color = "#fff";
                    btn.style.border = "1px solid orange";
                    btn.style.borderRadius = "4px";
                    btn.style.cursor = "pointer";
                    
                    // Highlight the dot button if selectedMod equals dp.factor
                    if (selectedMod !== null && Math.abs(selectedMod - dp.factor) < 0.001) {
                        btn.style.backgroundColor = "#ff0000";
                    }
                    
                    btn.addEventListener('click', () => {
                        // Toggle: if this dot button is already selected, unselect it (set modifier back to 1)
                        if (selectedMod !== null && Math.abs(selectedMod - dp.factor) < 0.001) {
                            selectedMod = 1;
                        } else {
                            selectedMod = dp.factor;
                        }
                        let originalExpr = value.raw;
                        let regex = /^new Fraction\(60\)\.div\((.*?)\)\.mul\((.*?)\)$/;
                        let newExpr;
                        let match = originalExpr.match(regex);
                        let baseForCalc = (selectedBase !== null ? selectedBase : (currentMultiplier !== null ? currentMultiplier : 1));
                        if (match) {
                            newExpr = `new Fraction(60).div(${match[1]}).mul(${baseForCalc * selectedMod})`;
                        } else {
                            newExpr = `new Fraction(60).div(module.findTempo(module.baseNote)).mul(${baseForCalc * selectedMod})`;
                        }
                        rawInput.value = newExpr;
                        saveButton.style.display = 'inline-block';
                        // Update highlighting for dot buttons.
                        Array.from(rightContainer.children).forEach(child => {
                            child.style.backgroundColor = "#444";
                        });
                        // Highlight only if modifier is not 1.
                        if (Math.abs(selectedMod - 1) > 0.001) {
                            btn.style.backgroundColor = "#ff0000";
                        }
                    });
                    rightContainer.appendChild(btn);
                });
                
                durationPicks.appendChild(leftContainer);
                durationPicks.appendChild(rightContainer);
                variableValueDiv.appendChild(durationPicks);
            }
                
            const rawInput = document.createElement('input');
            rawInput.type = 'text';
            rawInput.className = 'raw-value-input';
            rawInput.value = value.raw;
                
            const saveButton = document.createElement('button');
            saveButton.className = 'raw-value-save';
            saveButton.textContent = 'Save';
            saveButton.style.display = 'none';
                
            rawInput.addEventListener('input', () => {
                saveButton.style.display = 'inline-block';
            });
                
            saveButton.addEventListener('click', () => {
                const newRawValue = rawInput.value;
                try {
                    if (key === 'color') {
                        if (measureId !== null) {
                            throw new Error('Color should not be editable for measure points');
                        } else {
                            note.variables[key] = newRawValue;
                            window.myModule.markNoteDirty(note.id); // Mark as dirty
                        }
                    } else {
                        const currentNoteId = measureId !== null ? measureId : note.id;
                        const validatedExpression = validateExpression(window.myModule, currentNoteId, newRawValue, key);
                        if (measureId !== null) {
                            const measureNote = window.myModule.getNoteById(parseInt(measureId, 10));
                            if (measureNote) {
                                measureNote.setVariable(key, function () {
                                    return new Function("module", "Fraction", "return " + validatedExpression + ";")(window.myModule, Fraction);
                                });
                                measureNote.setVariable(key + 'String', newRawValue);
                                // Note: setVariable will mark the note as dirty
                            } else {
                                throw new Error('Unable to find measure note');
                            }
                        } else {
                            note.setVariable(key, function () {
                                return new Function("module", "Fraction", "return " + validatedExpression + ";")(window.myModule, Fraction);
                            });
                            note.setVariable(key + 'String', newRawValue);
                            // Note: setVariable will mark the note as dirty
                        }
                    }
                    
                    // Recompile this note and all its dependents recursively.
                    recompileNoteAndDependents(note.id);
                
                    // If the edited note is the BaseNote, update its fraction display and position.
                    if (note === window.myModule.baseNote) {
                        externalFunctions.updateBaseNoteFraction();
                        externalFunctions.updateBaseNotePosition();
                    }
                    
                    // Reevaluate and update the visual representation.
                    window.evaluatedNotes = window.myModule.evaluateModule();
                    externalFunctions.updateVisualNotes(window.evaluatedNotes);
                    
                    evaluatedDiv.innerHTML = `<span class="value-label">Evaluated:</span> ${note.getVariable(key) !== null ? String(note.getVariable(key)) : 'null'}`;
                    const newElem = document.querySelector(`[data-note-id="${note.id}"]`);
                    showNoteVariables(note, newElem, measureId);
                    
                } catch (error) {
                    console.error('Error updating note:', error);
                    const errorMsg = document.createElement('div');
                    errorMsg.className = 'error-message';
                    errorMsg.textContent = `Error: ${error.message}`;
                    rawDiv.appendChild(errorMsg);
                    setTimeout(() => errorMsg.remove(), 3000);
                    rawInput.value = value.raw;
                }
            });
                
            rawDiv.innerHTML = `<span class="value-label">Raw:</span>`;
            rawDiv.appendChild(rawInput);
            rawDiv.appendChild(saveButton);
                
            variableValueDiv.appendChild(evaluatedDiv);
            variableValueDiv.appendChild(rawDiv);
                
            variableRow.appendChild(variableNameDiv);
            variableRow.appendChild(variableValueDiv);
            widgetContent.appendChild(variableRow);
        });
        
        let shouldShowAdd = false;
        if (note === window.myModule.baseNote && !externalFunctions.hasMeasurePoints()) {
            shouldShowAdd = true;
        } else if (measureId !== null && String(measureId) === String(externalFunctions.getLastMeasureId())) {
            shouldShowAdd = true;
        }
        if (shouldShowAdd) {
            const addMeasureSection = document.createElement('div');
            addMeasureSection.className = 'variable-row';
            
            const addNameDiv = document.createElement('div');
            addNameDiv.className = 'variable-name';
            addNameDiv.textContent = 'Add Measure';
            
            const addValueDiv = document.createElement('div');
            addValueDiv.className = 'variable-value';
            
            const addBtn = document.createElement('button');
            addBtn.className = 'module-action-btn';
            addBtn.textContent = 'Add';
            addBtn.addEventListener('click', () => {
                // Recalculate current IDs and update nextId so that a new measure gets id = maxID + 1.
                const currentIDs = Object.keys(window.myModule.notes).map(id => parseInt(id, 10));
                const maxID = currentIDs.length > 0 ? Math.max(...currentIDs) : 0;
                window.myModule.nextId = maxID + 1;
            
                let newMeasures = [];
                let fromNote;
                if (note === window.myModule.baseNote && !externalFunctions.hasMeasurePoints()) {
                    fromNote = window.myModule.baseNote;
                    const newMeasure = window.myModule.addNote({
                        startTime: () => window.myModule.baseNote.getVariable('startTime'),
                        startTimeString: "module.baseNote.getVariable('startTime')"
                    });
                    newMeasure.parentId = window.myModule.baseNote.id;
                    newMeasures.push(newMeasure);
                    // Note: addNote will mark the note as dirty
                } else {
                    // When adding to an existing measure, use that measure as the parent.
                    fromNote = (note === window.myModule.baseNote) ? window.myModule.baseNote : window.myModule.getNoteById(measureId);
                    newMeasures = window.myModule.generateMeasures(fromNote, 1);
                    // Note: generateMeasures will mark the notes as dirty
                }
                
                // Force evaluation of startTime for each new measure.
                newMeasures.forEach(measure => {
                    measure.getVariable('startTime');
                });
                
                setTimeout(() => {
                    externalFunctions.updateTimingBoundaries();
                    externalFunctions.createMeasureBars();
                    window.evaluatedNotes = window.myModule.evaluateModule();
                    const newLast = externalFunctions.getLastMeasureId();
                    if (newLast !== null) {
                        const measureTriangle = document.querySelector(`.measure-bar-triangle[data-note-id="${newLast}"]`);
                        showNoteVariables(window.myModule.getNoteById(parseInt(newLast, 10)), measureTriangle, parseInt(newLast, 10));
                        if (measureTriangle) {
                            measureTriangle.classList.add('selected');
                        }
                    }
                }, 0);
            });
            
            addValueDiv.appendChild(addBtn);
            addMeasureSection.appendChild(addNameDiv);
            addMeasureSection.appendChild(addValueDiv);
            widgetContent.appendChild(addMeasureSection);
        }
        
        if (note !== window.myModule.baseNote) {
            const deleteWrapper = document.createElement('div');
            deleteWrapper.className = 'delete-note-row';
        
            const deleteHeader = document.createElement('div');
            deleteHeader.className = 'delete-note-header';
            deleteHeader.textContent = 'DELETE NOTE';
        
            const keepButton = document.createElement('button');
            keepButton.className = 'delete-note-btn keep-dependencies';
            keepButton.textContent = 'Keep Dependencies';
            keepButton.addEventListener('click', function() {
                showDeleteConfirmationKeepDependencies(effectiveNoteId);
            });
        
            const deleteDepsButton = document.createElement('button');
            deleteDepsButton.className = 'delete-note-btn delete-dependencies';
            deleteDepsButton.textContent = 'Delete Dependencies';
            deleteDepsButton.addEventListener('click', function() {
                showDeleteConfirmation(effectiveNoteId);
            });
        
            deleteWrapper.appendChild(deleteHeader);
            deleteWrapper.appendChild(keepButton);
            deleteWrapper.appendChild(deleteDepsButton);
        
            widgetContent.appendChild(deleteWrapper);
        }
        
        if (note === window.myModule.baseNote) {
            const deleteAllSection = document.createElement('div');
            deleteAllSection.className = 'delete-note-row';
            
            const deleteHeader = document.createElement('div');
            deleteHeader.className = 'delete-note-header';
            deleteHeader.textContent = 'DELETE ALL NOTES';
            
            const cleanSlateButton = document.createElement('button');
            cleanSlateButton.className = 'delete-note-btn delete-dependencies';
            cleanSlateButton.textContent = 'Clean Slate';
            cleanSlateButton.addEventListener('click', showCleanSlateConfirmation);
            
            deleteAllSection.appendChild(deleteHeader);
            deleteAllSection.appendChild(cleanSlateButton);
            
            widgetContent.appendChild(deleteAllSection);
        }
        
        domCache.noteWidget.classList.add('visible');
        widgetInitiallyOpened = true;
        updateNoteWidgetHeight();

        // If no clickedElement was provided, use the note's id to reapply the "selected" class.
        if (!clickedElement && note && note.id !== undefined) {
            const selElem = document.querySelector(`[data-note-id="${note.id}"]`);
            if (selElem) {
                selElem.classList.add("selected");
            }
        }
        
        // Store the current selected note
        currentSelectedNote = note;
    }

    // Helper for determining the note image
    function getDurationImageForBase(base) {
        if (base === 4) return "whole.png";
        else if (base === 2) return "half.png";
        else if (base === 1) return "quarter.png";
        else if (base === 0.5) return "eighth.png";
        else if (base === 0.25) return "sixteenth.png";
        return "";
    }

    // Helper that recursively recompiles a note (from its raw expressions) and all its dependent notes.
    function recompileNoteAndDependents(noteId, visited = new Set()) {
        if (visited.has(noteId)) return;
        visited.add(noteId);
        const note = window.myModule.getNoteById(noteId);
        if (!note) return;
        // For each variable that has a raw string (ending with "String"), recompile it
        Object.keys(note.variables).forEach(varKey => {
            if (varKey.endsWith("String")) {
                const baseKey = varKey.slice(0, -6);
                try {
                    const rawExpr = note.variables[varKey];
                    // Create and set the new function for this variable.
                    const newFunc = new Function("module", "Fraction", "return " + rawExpr + ";");
                    note.setVariable(baseKey, function() {
                        return newFunc(window.myModule, Fraction);
                    });
                } catch (err) {
                    console.error("Error recompiling note", noteId, "variable", baseKey, ":", err);
                }
            }
        });
        // Now recompile all dependent notes
        const dependents = window.myModule.getDependentNotes(noteId);
        dependents.forEach(depId => {
            recompileNoteAndDependents(depId, visited);
        });
    }

    // Clear selection and close widget
    function clearSelection() {
        domCache.noteWidget.classList.remove('visible');
        currentSelectedNote = null;
        
        // Use our optimized batch operation
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
    }

    // Update note widget height based on content
    function updateNoteWidgetHeight() {
        const widget = domCache.noteWidget;
        if (!widget) return;

        const header = widget.querySelector('.note-widget-header');
        const headerHeight = header ? header.getBoundingClientRect().height : 0;
        const rect = widget.getBoundingClientRect();
        const availableSpace = window.innerHeight - rect.top - MIN_BUFFER;

        const content = widget.querySelector('.note-widget-content');
        if (content) {
            const contentNaturalHeight = content.scrollHeight;
            const widgetDesiredHeight = headerHeight + contentNaturalHeight + 5;
            const minInitialHeight = widgetInitiallyOpened ? 40 : 300;
            const effectiveHeight = Math.max(minInitialHeight, Math.min(availableSpace, widgetDesiredHeight));
        
            widget.style.height = effectiveHeight + "px";
            widget.style.maxHeight = effectiveHeight + "px";
        
            let contentMax = effectiveHeight - headerHeight - 5;
            contentMax = Math.max(contentMax, 40);
            content.style.maxHeight = contentMax + "px";
            content.style.overflowY = "auto";
        }

        widget.style.overflow = "hidden";
    }

    // Handle window resize for widget positioning
    function handleWindowResize() {
        const widget = domCache.noteWidget;
        if (!widget) return;

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

        if (rect.height > maxWidgetHeight) {
            widget.style.height = maxWidgetHeight + "px";
            widget.style.maxHeight = maxWidgetHeight + "px";
        }

        updateNoteWidgetHeight();
    }

    // Make the note widget draggable
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

    // Delete note confirmation modals
    function showDeleteConfirmation(noteId) {
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
    
        // When clicking outside modal, only remove overlay without affecting selection.
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) {
                e.stopPropagation();
                document.body.removeChild(overlay);
            }
        });
    
        document.body.appendChild(overlay);
    }

    function showDeleteConfirmationKeepDependencies(noteId) {
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

    function showCleanSlateConfirmation() {
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

    // Validate expressions for note variables
    function validateExpression(moduleInstance, noteId, expression, variableType) {
        if (!expression || expression.trim() === '') {
            throw new Error('Expression cannot be empty or undefined');
        }

        if (expression.includes(`getNoteById(${noteId})`)) {
            throw new Error('Expression cannot reference itself directly');
        }
        
        if (detectCircularDependency(moduleInstance, noteId, expression, variableType)) {
            throw new Error('Circular dependency detected in expression');
        }
        
        try {
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
            
            // Convert the result to a valid bigfraction expression
            return `new Fraction(${result.n}, ${result.d})`;
        } catch (e) {
            console.error(`Error in expression execution for Note ${noteId}:`, e);
            throw new Error(`Invalid expression: ${e.message}`);
        }
    }

    // Cache for the dependency graph
    let dependencyGraphCache = null;
    let lastGraphUpdateTime = 0;

    function detectCircularDependency(moduleInstance, noteId, expression, variableType) {
        // Find references in the new expression
        const newReferences = findReferences(expression);
        
        // Check if we need to rebuild the dependency graph
        const currentModifiedTime = getModuleModifiedTime(moduleInstance);
        
        if (!dependencyGraphCache || currentModifiedTime > lastGraphUpdateTime) {
            dependencyGraphCache = buildDependencyGraph(moduleInstance);
            lastGraphUpdateTime = currentModifiedTime;
        }
        
        // Create a temporary graph that includes the new dependencies
        const tempGraph = JSON.parse(JSON.stringify(dependencyGraphCache));
        
        // Make sure the target note exists in the graph
        if (!tempGraph[noteId]) {
            tempGraph[noteId] = [];
        }
        
        // Add the new references to the temporary graph
        for (const refId of newReferences) {
            if (!tempGraph[noteId].includes(refId)) {
                tempGraph[noteId].push(refId);
            }
        }
        
        // Check for cycles in the graph starting from each reference
        for (const refId of newReferences) {
            if (hasPath(tempGraph, refId, noteId)) {
                return true; // Circular dependency detected
            }
        }
        
        return false; // No circular dependency detected
    }

    // Helper function to find all note references in an expression
    function findReferences(expr) {
        const regex = /getNoteById\((\d+)\)/g;
        const references = new Set();
        let match;
        while ((match = regex.exec(expr)) !== null) {
            references.add(parseInt(match[1], 10));
        }
        return Array.from(references);
    }

    // Build a directed graph of all dependencies in the module
    function buildDependencyGraph(moduleInstance) {
        // Initialize an empty graph
        const graph = {};
        
        // Initialize graph nodes for all notes
        for (const id in moduleInstance.notes) {
            graph[id] = [];
        }
        
        // Populate the graph with dependencies
        for (const id in moduleInstance.notes) {
            const note = moduleInstance.notes[id];
            if (!note || !note.variables) continue;
            
            // Get direct dependencies for this note
            const deps = moduleInstance.getDirectDependencies(parseInt(id, 10));
            
            // Add edges to the graph
            for (const depId of deps) {
                if (!graph[id].includes(depId)) {
                    graph[id].push(depId);
                }
            }
        }
        
        return graph;
    }

    // Check if there's a path from start to end in the graph using BFS
    function hasPath(graph, start, end) {
        // If start and end are the same, there's a trivial path
        if (start === end) return true;
        
        const visited = new Set();
        const queue = [start];
        
        while (queue.length > 0) {
            const current = queue.shift();
            
            if (current === end) {
                return true; // Path found
            }
            
            if (visited.has(current)) {
                continue; // Skip already visited nodes
            }
            
            visited.add(current);
            
            // Add all neighbors to the queue
            if (graph[current]) {
                for (const neighbor of graph[current]) {
                    if (!visited.has(neighbor)) {
                        queue.push(neighbor);
                    }
                }
            }
        }
        
        return false; // No path found
    }

    // Helper function to get the current modified time of the module
    function getModuleModifiedTime(moduleInstance) {
        if (!moduleInstance || !moduleInstance.notes) {
            return 0; // Return 0 if module or notes are undefined
        }
        
        return Object.values(moduleInstance.notes).reduce((maxTime, note) => {
            const noteTime = note.lastModifiedTime || 0;
            return Math.max(maxTime, noteTime);
        }, 0);
    }

    // Function to invalidate the dependency graph cache
    function invalidateDependencyGraphCache() {
        dependencyGraphCache = null;
    }

    // Set the external functions
    function setExternalFunctions(functions) {
        externalFunctions = { ...externalFunctions, ...functions };
    }

    // Initialize event listeners
    function init() {
        // Close widget button event listener
        domCache.closeWidgetBtn.addEventListener('click', () => {
            clearSelection();
        });

        // Window resize event listener
        window.addEventListener('resize', handleWindowResize);

        // Make the note widget draggable
        addDraggableNoteWidget();

        // Update note widget height initially
        updateNoteWidgetHeight();
    }

    // Public API
    window.modals = {
        showNoteVariables,
        clearSelection,
        updateNoteWidgetHeight,
        showDeleteConfirmation,
        showDeleteConfirmationKeepDependencies,
        showCleanSlateConfirmation,
        validateExpression,
        invalidateDependencyGraphCache,
        setExternalFunctions
    };

    // Initialize when DOM is loaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();