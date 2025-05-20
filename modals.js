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
    const MIN_BUFFER = 19;

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
        checkAndUpdateDependentNotes: null,
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

    // Function to extract the tempo part correctly, handling nested parentheses
    function extractTempoPart(expr) {
        if (!expr.startsWith("new Fraction(60).div(")) {
            return "new Fraction(60).div(module.findTempo(module.baseNote))";
        }
        
        // Start after "new Fraction(60).div("
        let start = "new Fraction(60).div(".length;
        let openParens = 1; // We already have one open parenthesis
        let end = start;
        
        // Find the matching closing parenthesis
        while (end < expr.length && openParens > 0) {
            if (expr[end] === '(') openParens++;
            else if (expr[end] === ')') openParens--;
            end++;
        }
        
        // If we found a matching closing parenthesis
        if (openParens === 0) {
            return expr.substring(0, end);
        }
        
        // Default if we couldn't parse correctly
        return "new Fraction(60).div(module.findTempo(module.baseNote))";
    }

    // Liberate dependencies from a note
    function liberateDependencies(noteId) {
        const selectedNote = myModule.getNoteById(noteId);
        if (!selectedNote) return;
        
        // Store the currently selected note for later
        const currentSelectedNote = selectedNote;
        
        // Check if this is a measure bar (has startTime but no duration)
        const isMeasureBar = selectedNote.variables.startTime && !selectedNote.variables.duration;
        
        // Don't allow liberating dependencies on measure bars
        if (isMeasureBar) {
            showNotification('Cannot liberate dependencies on measure bars', 'error');
            return;
        }
        
        // Create a snapshot of the raw expressions
        let selectedRaw = {};
        ["startTime", "duration", "frequency"].forEach(varName => {
            if (selectedNote.variables[varName + "String"]) {
                // Use the existing raw expression if available.
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
                if (!fracStr.includes("/")) {
                    fracStr = fracStr + "/1";
                }
                selectedRaw[varName] = "new Fraction(" + fracStr + ")";
            }
        });
        
        // Use the external function to update dependent notes
        externalFunctions.updateDependentRawExpressions(noteId, selectedRaw);
        
        // Mark all notes that depended on this note as dirty
        const dependents = myModule.getDependentNotes(noteId);
        dependents.forEach(depId => {
            myModule.markNoteDirty(depId);
        });
        
        // Re-evaluate the module
        evaluatedNotes = myModule.evaluateModule();
        externalFunctions.updateVisualNotes(evaluatedNotes);
        
        // Find the new element for the note after DOM update
        const newElem = document.querySelector(`.note-content[data-note-id="${noteId}"]`);
        
        // Re-apply the bring to front functionality for the selected note
        if (currentSelectedNote && currentSelectedNote.id !== 0 && newElem) {
            // Only bring to front if it's not the base note
            if (externalFunctions.bringSelectedNoteToFront) {
                externalFunctions.bringSelectedNoteToFront(currentSelectedNote, newElem);
            }
        }
        
        // Now show the note variables (which will also mark it as selected)
        showNoteVariables(currentSelectedNote, newElem);
        
        // Show notification
        showNotification('Dependencies liberated successfully!', 'success');
    }

    function findParentWithFrequency(note) {
        // Returns the nearest ancestor note with a frequency, or null
        if (!note) return null;
        let parentId = null;
        // Try to extract parent from startTimeString
        const startTimeString = note.variables.startTimeString;
        if (startTimeString) {
            const match = /getNoteById\((\d+)\)/.exec(startTimeString);
            if (match) parentId = parseInt(match[1], 10);
        }
        // Try parentId property if present
        if (parentId === null && note.parentId !== undefined) parentId = note.parentId;
        // Fallback to base note
        if (parentId === null) parentId = 0;
        if (parentId === note.id) return null; // avoid self-loop
        const parent = window.myModule.getNoteById(parentId);
        if (!parent) return null;
        if (typeof parent.getVariable === 'function' && parent.getVariable('frequency')) return parent;
        return findParentWithFrequency(parent);
    }

    function replaceFrequencyParentInFormula(formula, newParentId) {
        // Replace only the .mul(module.getNoteById(...).getVariable('frequency'))
        // part of the formula with the correct parent note ID.
        return formula.replace(
            /\.mul\s*\(\s*module\.getNoteById\(\s*\d+\s*\)\.getVariable\('frequency'\)\s*\)/,
            `.mul(module.getNoteById(${newParentId}).getVariable('frequency'))`
        );
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
        
        // Check if this is a silence note (has startTime and duration but no frequency)
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
            
            // Make sure instrument is included for the base note
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
            
            // Handle instrument with inheritance
            const hasOwnInstrument = note.variables.instrument !== undefined;
            const inheritedInstrument = window.myModule.findInstrument(note);
    
            variables.instrument = {
                evaluated: hasOwnInstrument ? note.getVariable('instrument') : inheritedInstrument,
                raw: hasOwnInstrument ? note.getVariable('instrument') : inheritedInstrument,
                isInherited: !hasOwnInstrument
            };
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
        
        // Create the evaluated value div
        let evaluatedDiv = document.createElement('div');
        evaluatedDiv.className = 'evaluated-value';
        
        // Special handling for instrument variable
        if (key === 'instrument') {
            // Create a container for instrument selection
            const instrumentContainer = document.createElement('div');
            instrumentContainer.style.display = 'flex';
            instrumentContainer.style.flexDirection = 'column';
            instrumentContainer.style.gap = '8px';
            
            // Add the evaluated value text with inheritance indicator
            const evaluatedText = document.createElement('div');
            if (value.isInherited) {
                evaluatedText.innerHTML = `<span class="value-label">Inherited:</span> <span style="color: #aaa;">${value.evaluated}</span>`;
            } else {
                evaluatedText.innerHTML = `<span class="value-label">Current:</span> ${value.evaluated}`;
            }
            instrumentContainer.appendChild(evaluatedText);
            
            // Create instrument dropdown
            const instrumentSelect = document.createElement('select');
            instrumentSelect.className = 'instrument-select';
            instrumentSelect.style.padding = '4px';
            instrumentSelect.style.backgroundColor = '#333';
            instrumentSelect.style.color = '#ffa800';
            instrumentSelect.style.border = '1px solid #ffa800';
            instrumentSelect.style.borderRadius = '4px';
            instrumentSelect.style.width = '100%';
            instrumentSelect.style.marginTop = '5px';
            
            // Get instruments dynamically from the instrument manager
            let synthInstruments = [];
            let sampleInstruments = [];

            if (window.instrumentManager) {
                try {
                    // Get all available instruments
                    const allInstruments = window.instrumentManager.getAvailableInstruments();
                    
                    // Separate instruments by type
                    allInstruments.forEach(instName => {
                        const instrument = window.instrumentManager.getInstrument(instName);
                        if (instrument) {
                            if (instrument.type === 'sample') {
                                sampleInstruments.push(instName);
                            } else {
                                synthInstruments.push(instName);
                            }
                        }
                    });
                    
                    // Sort each category alphabetically
                    //synthInstruments.sort();
                    sampleInstruments.sort();
                } catch (err) {
                    console.warn('Failed to get available instruments from instrumentManager:', err);
                    // Fallback to default instruments if there's an error
                    synthInstruments = ['sine-wave', 'square-wave', 'sawtooth-wave', 'triangle-wave', 'organ', 'vibraphone'];
                    sampleInstruments = [];
                }
            } else {
                // Fallback to default instruments if instrumentManager is not available
                synthInstruments = ['sine-wave', 'square-wave', 'sawtooth-wave', 'triangle-wave', 'organ', 'vibraphone'];
                sampleInstruments = [];
            }

            // Create optgroup for synthesized instruments
            if (synthInstruments.length > 0) {
                const synthGroup = document.createElement('optgroup');
                synthGroup.label = 'Synthesized';
                
                synthInstruments.forEach(inst => {
                    const option = document.createElement('option');
                    option.value = inst;
                    option.textContent = inst;
                    if (value.evaluated === inst) {
                        option.selected = true;
                    }
                    synthGroup.appendChild(option);
                });
                
                instrumentSelect.appendChild(synthGroup);
            }

            // Create optgroup for sample-based instruments
            if (sampleInstruments.length > 0) {
                const sampleGroup = document.createElement('optgroup');
                sampleGroup.label = 'Samples';
                
                sampleInstruments.forEach(inst => {
                    const option = document.createElement('option');
                    option.value = inst;
                    option.textContent = inst;
                    if (value.evaluated === inst) {
                        option.selected = true;
                    }
                    sampleGroup.appendChild(option);
                });
                
                instrumentSelect.appendChild(sampleGroup);
            }

            // If no instruments were added (unlikely), add a default option
            if (instrumentSelect.children.length === 0) {
                const option = document.createElement('option');
                option.value = 'sine-wave';
                option.textContent = 'sine-wave';
                if (value.evaluated === 'sine-wave') {
                    option.selected = true;
                }
                instrumentSelect.appendChild(option);
            }
            
            // Create save button (initially hidden)
            const saveButton = document.createElement('button');
            saveButton.className = 'raw-value-save';
            saveButton.textContent = 'Save';
            saveButton.style.display = 'none';
            saveButton.style.marginTop = '5px';
            
            // Add change handler for the dropdown to show the save button
            instrumentSelect.addEventListener('input', () => {
                saveButton.style.display = 'block';
            });
            
            // Add click handler for the save button
            saveButton.addEventListener('click', () => {
                try {
                    // If playback is ongoing, pause it
                    if (window.playerState && window.playerState.isPlaying && !window.playerState.isPaused && window.playerControls && window.playerControls.pause) {
                        window.playerControls.pause();
                    }
                    
                    // Store the current selected note for later
                    const currentlySelectedNote = note;
                    
                    // Update the instrument value
                    const newValue = instrumentSelect.value;
                    note.setVariable('instrument', newValue);
                    
                    // Reevaluate and update the visual representation
                    window.evaluatedNotes = window.myModule.evaluateModule();
                    externalFunctions.updateVisualNotes(window.evaluatedNotes);
                    
                    // Find the new element for the note after DOM update
                    const newElem = document.querySelector(`.note-content[data-note-id="${note.id}"]`);
                    
                    // Re-apply the bring to front functionality for the selected note
                    if (currentlySelectedNote && currentlySelectedNote.id !== 0 && newElem) {
                        // Only bring to front if it's not the base note
                        if (externalFunctions.bringSelectedNoteToFront) {
                            externalFunctions.bringSelectedNoteToFront(currentlySelectedNote, newElem);
                        }
                    }
                    
                    // Now show the note variables (which will also mark it as selected)
                    showNoteVariables(currentlySelectedNote, newElem);
                    
                } catch (error) {
                    console.error('Error updating instrument:', error);
                    const errorMsg = document.createElement('div');
                    errorMsg.className = 'error-message';
                    errorMsg.textContent = `Error: ${error.message}`;
                    instrumentContainer.appendChild(errorMsg);
                    setTimeout(() => errorMsg.remove(), 3000);
                    instrumentSelect.value = value.evaluated;
                }
            });
            
            // Add a "Use Inherited" button if the note has its own instrument value
            // and it's not the base note (which can't inherit)
            if (!value.isInherited && note.id !== 0) {
                const resetButton = document.createElement('button');
                resetButton.className = 'raw-value-save';
                resetButton.textContent = 'Use Inherited';
                resetButton.style.backgroundColor = '#555';
                resetButton.style.marginTop = '5px';
                
                resetButton.addEventListener('click', () => {
                    try {
                        // If playback is ongoing, pause it
                        if (window.playerState && window.playerState.isPlaying && !window.playerState.isPaused && window.playerControls && window.playerControls.pause) {
                            window.playerControls.pause();
                        }
                        
                        // Store the current selected note for later
                        const currentlySelectedNote = note;
                        
                        // Delete the instrument property to use inheritance
                        delete note.variables.instrument;
                        
                        // Mark the note as dirty
                        window.myModule.markNoteDirty(note.id);
                        
                        // Reevaluate and update the visual representation
                        window.evaluatedNotes = window.myModule.evaluateModule();
                        externalFunctions.updateVisualNotes(window.evaluatedNotes);
                        
                        // Find the new element for the note after DOM update
                        const newElem = document.querySelector(`.note-content[data-note-id="${note.id}"]`);
                        
                        // Re-apply the bring to front functionality for the selected note
                        if (currentlySelectedNote && currentlySelectedNote.id !== 0 && newElem) {
                            // Only bring to front if it's not the base note
                            if (externalFunctions.bringSelectedNoteToFront) {
                                externalFunctions.bringSelectedNoteToFront(currentlySelectedNote, newElem);
                            }
                        }
                        
                        // Now show the note variables (which will also mark it as selected)
                        showNoteVariables(currentlySelectedNote, newElem);
                        
                    } catch (error) {
                        console.error('Error resetting instrument:', error);
                        const errorMsg = document.createElement('div');
                        errorMsg.className = 'error-message';
                        errorMsg.textContent = `Error: ${error.message}`;
                        instrumentContainer.appendChild(errorMsg);
                        setTimeout(() => errorMsg.remove(), 3000);
                    }
                });
                
                instrumentContainer.appendChild(resetButton);
            }
            
            // Add dropdown and save button to the container
            instrumentContainer.appendChild(instrumentSelect);
            instrumentContainer.appendChild(saveButton);
            
            // Add the instrument container to the evaluated div
            evaluatedDiv.appendChild(instrumentContainer);
            
            // Add the evaluated div to the variable value div
            variableValueDiv.appendChild(evaluatedDiv);
            
            // For instrument, we skip adding the raw div entirely
            
        } else if (key === 'frequency') { // Add octave buttons for frequency variable
            // Create a container for the evaluated value and octave buttons
            const evaluatedContainer = document.createElement('div');
            evaluatedContainer.style.display = 'flex';
            evaluatedContainer.style.justifyContent = 'space-between';
            evaluatedContainer.style.alignItems = 'center';
            
            // Add the evaluated value text
            const evaluatedText = document.createElement('div');
            evaluatedText.innerHTML = `<span class="value-label">Evaluated:</span> ${value.evaluated !== null ? String(value.evaluated) : 'null'}`;
            evaluatedContainer.appendChild(evaluatedText);
            
            // Create octave buttons container
            const octaveButtonsContainer = document.createElement('div');
            octaveButtonsContainer.style.display = 'flex';
            octaveButtonsContainer.style.flexDirection = 'column';
            octaveButtonsContainer.style.marginLeft = '10px';
            
            // Create up octave button
            const upOctaveButton = document.createElement('button');
            upOctaveButton.className = 'octave-button octave-up-widget';
            upOctaveButton.textContent = '▲';
            upOctaveButton.style.width = '26px';  // Match the width of duration buttons
            upOctaveButton.style.height = '26px'; // Match the height of duration buttons
            upOctaveButton.style.padding = '0';
            upOctaveButton.style.backgroundColor = '#444'; // Match the background of duration buttons
            upOctaveButton.style.border = '1px solid orange'; // Match the orange border
            upOctaveButton.style.borderRadius = '4px'; // Match the border radius
            upOctaveButton.style.cursor = 'pointer';
            upOctaveButton.style.display = 'flex';
            upOctaveButton.style.alignItems = 'center';
            upOctaveButton.style.justifyContent = 'center';
            upOctaveButton.style.fontSize = '14px'; // Larger font size to match duration buttons
            upOctaveButton.style.color = '#fff';
            upOctaveButton.style.marginBottom = '4px'; // Add some spacing between buttons

            // Create down octave button
            const downOctaveButton = document.createElement('button');
            downOctaveButton.className = 'octave-button octave-down-widget';
            downOctaveButton.textContent = '▼';
            downOctaveButton.style.width = '26px';  // Match the width of duration buttons
            downOctaveButton.style.height = '26px'; // Match the height of duration buttons
            downOctaveButton.style.padding = '0';
            downOctaveButton.style.backgroundColor = '#444'; // Match the background of duration buttons
            downOctaveButton.style.border = '1px solid orange'; // Match the orange border
            downOctaveButton.style.borderRadius = '4px'; // Match the border radius
            downOctaveButton.style.cursor = 'pointer';
            downOctaveButton.style.display = 'flex';
            downOctaveButton.style.alignItems = 'center';
            downOctaveButton.style.justifyContent = 'center';
            downOctaveButton.style.fontSize = '14px'; // Larger font size to match duration buttons
            downOctaveButton.style.color = '#fff';
            
            // Add hover effects
            upOctaveButton.addEventListener('mouseenter', () => {
                upOctaveButton.style.background = 'rgba(255, 255, 255, 0.4)';
            });
            
            upOctaveButton.addEventListener('mouseleave', () => {
                upOctaveButton.style.background = 'rgba(255, 255, 255, 0.2)';
            });
            
            downOctaveButton.addEventListener('mouseenter', () => {
                downOctaveButton.style.background = 'rgba(255, 255, 255, 0.4)';
            });
            
            downOctaveButton.addEventListener('mouseleave', () => {
                downOctaveButton.style.background = 'rgba(255, 255, 255, 0.2)';
            });
            
            // Add click handlers
            upOctaveButton.addEventListener('click', (event) => {
                event.stopPropagation();
                event.preventDefault();
                // Use window.handleOctaveChange to access the global function
                window.handleOctaveChange(note.id, 'up');
            });
            
            downOctaveButton.addEventListener('click', (event) => {
                event.stopPropagation();
                event.preventDefault();
                // Use window.handleOctaveChange to access the global function
                window.handleOctaveChange(note.id, 'down');
            });
            
            // Add buttons to container
            octaveButtonsContainer.appendChild(upOctaveButton);
            octaveButtonsContainer.appendChild(downOctaveButton);
            
            // Add buttons container to evaluated container
            evaluatedContainer.appendChild(octaveButtonsContainer);
            
            // Replace the original evaluated div with our container
            evaluatedDiv.appendChild(evaluatedContainer);
            
            variableValueDiv.appendChild(evaluatedDiv);
            
            const rawDiv = document.createElement('div');
            rawDiv.className = 'raw-value';
            
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
                    // If playback is ongoing, pause it
                    if (window.playerState && window.playerState.isPlaying && !window.playerState.isPaused && window.playerControls && window.playerControls.pause) {
                        window.playerControls.pause();
                    }
                    
                    // Store the current selected note for later
                    const currentlySelectedNote = note;
                    
                    // Check if this is a measure bar triangle
                    const isMeasureBar = measureId !== null;
                    let currentZIndex = null;
                    
                    // If it's a measure bar triangle, store its current z-index
                    if (isMeasureBar) {
                        const triangleElement = document.querySelector(`.measure-bar-triangle[data-note-id="${measureId}"]`);
                        if (triangleElement) {
                            currentZIndex = window.getComputedStyle(triangleElement).zIndex;
                        }
                    }
                    
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
                        
                        // If this is a duration change, store the original duration
                        let originalDuration;
                        if (key === 'duration') {
                            originalDuration = note.getVariable('duration').valueOf();
                        }
                        
                        if (measureId !== null) {
                            const measureNote = window.myModule.getNoteById(parseInt(measureId, 10));
                            if (measureNote) {
                                measureNote.setVariable(key, function () {
                                    return new Function("module", "Fraction", "return " + validatedExpression + ";")(window.myModule, Fraction);
                                });
                                measureNote.setVariable(key + 'String', newRawValue);
                                // Note: setVariable will mark the note as dirty
                                
                                // If this is a duration change, check and update dependent notes
                                if (key === 'duration') {
                                    const updatedDuration = note.getVariable('duration').valueOf();
                                    if (Math.abs(originalDuration - updatedDuration) > 0.001) {
                                        // Use the external function instead of direct call
                                        externalFunctions.checkAndUpdateDependentNotes(noteId, originalDuration, updatedDuration);
                                    }
                                }
                            } else {
                                throw new Error('Unable to find measure note');
                            }
                        } else {
                            note.setVariable(key, function () {
                                return new Function("module", "Fraction", "return " + validatedExpression + ";")(window.myModule, Fraction);
                            });
                            note.setVariable(key + 'String', newRawValue);
                            // Note: setVariable will mark the note as dirty
                            
                            // If this is a duration change, check and update dependent notes
                            if (key === 'duration') {
                                const updatedDuration = note.getVariable('duration').valueOf();
                                if (Math.abs(originalDuration - updatedDuration) > 0.001) {
                                    externalFunctions.checkAndUpdateDependentNotes(note.id, originalDuration, updatedDuration);
                                }
                            }
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
                    
                    // Find the new element for the note after DOM update
                    let newElem;
                    
                    if (isMeasureBar) {
                        // For measure bars, find the triangle element
                        newElem = document.querySelector(`.measure-bar-triangle[data-note-id="${measureId}"]`);
                        
                        // Restore the z-index if we have it
                        if (newElem && currentZIndex) {
                            newElem.style.zIndex = currentZIndex;
                        }
                    } else {
                        // For regular notes
                        newElem = document.querySelector(`.note-content[data-note-id="${note.id}"]`);
                        
                        // Re-apply the bring to front functionality for tapspace notes
                        if (currentlySelectedNote && currentlySelectedNote.id !== 0 && newElem) {
                            // Only bring to front if it's not the base note
                            if (externalFunctions.bringSelectedNoteToFront) {
                                externalFunctions.bringSelectedNoteToFront(currentlySelectedNote, newElem);
                            }
                        }
                    }
                    
                    // Now show the note variables (which will also mark it as selected)
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
                
            variableValueDiv.appendChild(rawDiv);
        } else {
            // For non-frequency, non-instrument variables, use the standard format
            evaluatedDiv.innerHTML = `<span class="value-label">Evaluated:</span> ${value.evaluated !== null ? String(value.evaluated) : 'null'}`;
            
            variableValueDiv.appendChild(evaluatedDiv);
            
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
                
                // First try to match the decimal format: mul(0.5)
                let decimalRegex = /^new Fraction\(60\)\.div\((.*?)\)\.mul\(([\d\.]+)\)$/;
                let decimalMatch = value.raw.match(decimalRegex);
                
                if (decimalMatch && decimalMatch[2]) {
                    currentMultiplier = parseFloat(decimalMatch[2]);
                } else {
                    // Try to match the Fraction format: mul(new Fraction(1, 2))
                    let fractionRegex = /^new Fraction\(60\)\.div\((.*?)\)\.mul\(new Fraction\((\d+),\s*(\d+)\)\)$/;
                    let fractionMatch = value.raw.match(fractionRegex);
                    
                    if (fractionMatch && fractionMatch[2] && fractionMatch[3]) {
                        const numerator = parseInt(fractionMatch[2], 10);
                        const denominator = parseInt(fractionMatch[3], 10);
                        if (!isNaN(numerator) && !isNaN(denominator) && denominator !== 0) {
                            currentMultiplier = numerator / denominator;
                        }
                    } else {
                        // If no multiplication is found, assume the default multiplier is 1 (representing a quarter note).
                        currentMultiplier = 1;
                    }
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
                    btn.style.transition = "background-color 0.3s ease"; // Add transition for smooth hover effect
                    
                    // Highlight the base button if bp.base matches the selected base (regardless of modifier)
                    if (selectedBase !== null && Math.abs(bp.base - selectedBase) < 0.001) {
                        btn.style.backgroundColor = "#ff0000";
                    }
                    
                    // Add hover effects
                    btn.addEventListener('mouseenter', () => {
                        if (!(selectedBase !== null && Math.abs(bp.base - selectedBase) < 0.001)) {
                            btn.style.backgroundColor = "rgba(255, 255, 255, 0.4)";
                        }
                    });
                    
                    btn.addEventListener('mouseleave', () => {
                        if (!(selectedBase !== null && Math.abs(bp.base - selectedBase) < 0.001)) {
                            btn.style.backgroundColor = "#444";
                        }
                    });
                    
                    btn.addEventListener('click', () => {
                        selectedBase = bp.base;
                        let originalExpr = value.raw;
                        let newExpr;
                        
                        // Create the new expression using Fraction format
                        const baseForCalc = selectedBase;
                        const modForCalc = selectedMod;
                        const multiplier = baseForCalc * modForCalc;
                        
                        // Convert the multiplier to a Fraction
                        let fraction;
                        try {
                            fraction = new Fraction(multiplier);
                        } catch (err) {
                            console.error("Error creating fraction:", err);
                            // Fallback to manual fraction creation
                            if (multiplier === 0.25) fraction = new Fraction(1, 4);
                            else if (multiplier === 0.5) fraction = new Fraction(1, 2);
                            else if (multiplier === 0.75) fraction = new Fraction(3, 4);
                            else if (multiplier === 1) fraction = new Fraction(1, 1);
                            else if (multiplier === 1.5) fraction = new Fraction(3, 2);
                            else if (multiplier === 2) fraction = new Fraction(2, 1);
                            else if (multiplier === 3) fraction = new Fraction(3, 1);
                            else if (multiplier === 4) fraction = new Fraction(4, 1);
                            else fraction = new Fraction(Math.round(multiplier * 4), 4); // Approximate as quarters
                        }
                        
                        // Instead of trying to parse the original expression, create a new one from scratch
                        // First, determine what tempo reference to use
                        let tempoReference;
                        if (originalExpr.includes("module.getNoteById")) {
                            // Try to extract the note ID
                            const noteIdMatch = originalExpr.match(/module\.getNoteById\((\d+)\)/);
                            if (noteIdMatch && noteIdMatch[1]) {
                                tempoReference = `module.findTempo(module.getNoteById(${noteIdMatch[1]}))`;
                            } else {
                                tempoReference = "module.findTempo(module.baseNote)";
                            }
                        } else {
                            tempoReference = "module.findTempo(module.baseNote)";
                        }
                        
                        // Create the new expression
                        newExpr = `new Fraction(60).div(${tempoReference}).mul(new Fraction(${fraction.n}, ${fraction.d}))`;
                        
                        rawInput.value = newExpr;
                        saveButton.style.display = 'inline-block';
                        
                        // Update highlighting for all base buttons
                        Array.from(leftContainer.children).forEach(child => {
                            child.style.backgroundColor = "#444";
                        });
                        btn.style.backgroundColor = "#ff0000";
                        
                        // Clear highlighting for dot buttons if we're selecting a base without a dot
                        if (Math.abs(selectedMod - 1) < 0.001) {
                            Array.from(rightContainer.children).forEach(child => {
                                child.style.backgroundColor = "#444";
                            });
                        }
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
                    btn.style.transition = "background-color 0.3s ease"; // Add transition for smooth hover effect
                    
                    // Highlight the dot button if selectedMod equals dp.factor
                    if (selectedMod !== null && Math.abs(selectedMod - dp.factor) < 0.001) {
                        btn.style.backgroundColor = "#ff0000";
                    }
                    
                    // Add hover effects
                    btn.addEventListener('mouseenter', () => {
                        if (!(selectedMod !== null && Math.abs(selectedMod - dp.factor) < 0.001)) {
                            btn.style.backgroundColor = "rgba(255, 255, 255, 0.4)";
                        }
                    });
                    
                    btn.addEventListener('mouseleave', () => {
                        if (!(selectedMod !== null && Math.abs(selectedMod - dp.factor) < 0.001)) {
                            btn.style.backgroundColor = "#444";
                        }
                    });
                    
                    btn.addEventListener('click', () => {
                        // Toggle: if this dot button is already selected, unselect it (set modifier back to 1)
                        if (selectedMod !== null && Math.abs(selectedMod - dp.factor) < 0.001) {
                            selectedMod = 1;
                        } else {
                            selectedMod = dp.factor;
                        }
                        
                        let originalExpr = value.raw;
                        let newExpr;
                        
                        // Create the new expression using Fraction format
                        const baseForCalc = selectedBase !== null ? selectedBase : 1; // Default to quarter note
                        const modForCalc = selectedMod;
                        const multiplier = baseForCalc * modForCalc;
                        
                        // Convert the multiplier to a Fraction
                        let fraction;
                        try {
                            fraction = new Fraction(multiplier);
                        } catch (err) {
                            console.error("Error creating fraction:", err);
                            // Fallback to manual fraction creation
                            if (multiplier === 0.25) fraction = new Fraction(1, 4);
                            else if (multiplier === 0.5) fraction = new Fraction(1, 2);
                            else if (multiplier === 0.75) fraction = new Fraction(3, 4);
                            else if (multiplier === 1) fraction = new Fraction(1, 1);
                            else if (multiplier === 1.5) fraction = new Fraction(3, 2);
                            else if (multiplier === 2) fraction = new Fraction(2, 1);
                            else if (multiplier === 3) fraction = new Fraction(3, 1);
                            else if (multiplier === 4) fraction = new Fraction(4, 1);
                            else fraction = new Fraction(Math.round(multiplier * 4), 4); // Approximate as quarters
                        }
                        
                        // Extract the tempo part from the original expression
                        let tempoPart = extractTempoPart(originalExpr);
                
                        // Create the new expression
                        newExpr = `${tempoPart}.mul(new Fraction(${fraction.n}, ${fraction.d}))`;
                        
                        rawInput.value = newExpr;
                        saveButton.style.display = 'inline-block';
                        
                        // Update highlighting for dot buttons
                        Array.from(rightContainer.children).forEach(child => {
                            child.style.backgroundColor = "#444";
                        });
                        
                        // Highlight only if modifier is not 1
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
                
            const rawDiv = document.createElement('div');
            rawDiv.className = 'raw-value';
            
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
                    // If playback is ongoing, pause it
                    if (window.playerState && window.playerState.isPlaying && !window.playerState.isPaused && window.playerControls && window.playerControls.pause) {
                        window.playerControls.pause();
                    }
                    
                    // Store the current selected note for later
                    const currentlySelectedNote = note;
                    
                    // Check if this is a measure bar triangle
                    const isMeasureBar = measureId !== null;
                    let currentZIndex = null;
                    
                    // If it's a measure bar triangle, store its current z-index
                    if (isMeasureBar) {
                        const triangleElement = document.querySelector(`.measure-bar-triangle[data-note-id="${measureId}"]`);
                        if (triangleElement) {
                            currentZIndex = window.getComputedStyle(triangleElement).zIndex;
                        }
                    }
                    
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
                        
                        // If this is a duration change, store the original duration
                        let originalDuration;
                        if (key === 'duration') {
                            originalDuration = note.getVariable('duration').valueOf();
                        }
                        
                        if (measureId !== null) {
                            const measureNote = window.myModule.getNoteById(parseInt(measureId, 10));
                            if (measureNote) {
                                measureNote.setVariable(key, function () {
                                    return new Function("module", "Fraction", "return " + validatedExpression + ";")(window.myModule, Fraction);
                                });
                                measureNote.setVariable(key + 'String', newRawValue);
                                // Note: setVariable will mark the note as dirty
                                
                                // If this is a duration change, check and update dependent notes
                                if (key === 'duration') {
                                    const updatedDuration = note.getVariable('duration').valueOf();
                                    if (Math.abs(originalDuration - updatedDuration) > 0.001) {
                                        // Use the external function instead of direct call
                                        externalFunctions.checkAndUpdateDependentNotes(noteId, originalDuration, updatedDuration);
                                    }
                                }
                            } else {
                                throw new Error('Unable to find measure note');
                            }
                        } else {
                            note.setVariable(key, function () {
                                return new Function("module", "Fraction", "return " + validatedExpression + ";")(window.myModule, Fraction);
                            });
                            note.setVariable(key + 'String', newRawValue);
                            // Note: setVariable will mark the note as dirty
                            
                            // If this is a duration change, check and update dependent notes
                            if (key === 'duration') {
                                const updatedDuration = note.getVariable('duration').valueOf();
                                if (Math.abs(originalDuration - updatedDuration) > 0.001) {
                                    externalFunctions.checkAndUpdateDependentNotes(note.id, originalDuration, updatedDuration);
                                }
                            }
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
                    
                    // Find the new element for the note after DOM update
                    let newElem;
                    
                    if (isMeasureBar) {
                        // For measure bars, find the triangle element
                        newElem = document.querySelector(`.measure-bar-triangle[data-note-id="${measureId}"]`);
                        
                        // Restore the z-index if we have it
                        if (newElem && currentZIndex) {
                            newElem.style.zIndex = currentZIndex;
                        }
                    } else {
                        // For regular notes
                        newElem = document.querySelector(`.note-content[data-note-id="${note.id}"]`);
                        
                        // Re-apply the bring to front functionality for tapspace notes
                        if (currentlySelectedNote && currentlySelectedNote.id !== 0 && newElem) {
                            // Only bring to front if it's not the base note
                            if (externalFunctions.bringSelectedNoteToFront) {
                                externalFunctions.bringSelectedNoteToFront(currentlySelectedNote, newElem);
                            }
                        }
                    }
                    
                    // Now show the note variables (which will also mark it as selected)
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
                
            variableValueDiv.appendChild(rawDiv);
        }
        
        variableRow.appendChild(variableNameDiv);
        variableRow.appendChild(variableValueDiv);
        widgetContent.appendChild(variableRow);
        });
                        
        
        let shouldShowAdd = false;
        if (note === window.myModule.baseNote) {
            // Always show the button for the base note, regardless of whether measure points exist
            shouldShowAdd = true;
        } else if (measureId !== null) {
            // For measure bars, check if this is the last measure in its chain
            shouldShowAdd = externalFunctions.isLastMeasureInChain(measureId);
        }
        
        if (shouldShowAdd) {
            const addMeasureSection = document.createElement('div');
            addMeasureSection.className = 'variable-row';
            
            const addNameDiv = document.createElement('div');
            addNameDiv.className = 'variable-name';
            
            // Change the label based on whether it's the base note or a measure
            if (note === window.myModule.baseNote) {
                addNameDiv.textContent = 'Add New Measure Chain';
            } else {
                addNameDiv.textContent = 'Add Measure';
            }
            
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
                if (note === window.myModule.baseNote) {
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
                
                // Get the newly added measure (should be just one)
                const newMeasure = newMeasures[0];
                
                if (newMeasure) {
                    // Calculate the start and end times of the new measure
                    const newMeasureStart = newMeasure.getVariable('startTime').valueOf();
                    const measureLength = window.myModule.findMeasureLength(newMeasure).valueOf();
                    const newMeasureEnd = newMeasureStart + measureLength;
                    
                    // Find all notes that directly depend on the previous measure
                    const directDependents = [];
                    
                    // Helper function to check if a note directly depends on the measure
                    const isDirectlyDependentOnMeasure = (noteId, measureId) => {
                        const note = window.myModule.getNoteById(noteId);
                        if (!note || !note.variables || !note.variables.startTimeString) {
                            return false;
                        }
                        
                        // Check if the startTimeString directly references the measure
                        const startTimeString = note.variables.startTimeString;
                        const regex = new RegExp(`module\\.getNoteById\\(\\s*${measureId}\\s*\\)\\.getVariable\\('startTime'\\)`);
                        return regex.test(startTimeString);
                    };
                    
                    // Find all notes that directly depend on the previous measure
                    Object.keys(window.myModule.notes).forEach(id => {
                        const noteId = parseInt(id, 10);
                        if (noteId !== newMeasure.id && isDirectlyDependentOnMeasure(noteId, fromNote.id)) {
                            directDependents.push(noteId);
                        }
                    });
                    
                    // For each directly dependent note, check if its start time falls within the new measure
                    directDependents.forEach(depId => {
                        const depNote = window.myModule.getNoteById(depId);
                        
                        // Skip if not a valid note
                        if (!depNote || !depNote.getVariable) {
                            return;
                        }
                        
                        // Get the note's start time
                        const noteStartTime = depNote.getVariable('startTime').valueOf();
                        
                        // Check if the note's start time falls within the new measure
                        if (noteStartTime >= newMeasureStart && noteStartTime < newMeasureEnd) {
                            // Calculate the beat offset from the new measure's start
                            const baseTempo = window.myModule.baseNote.getVariable('tempo').valueOf();
                            const beatLength = 60 / baseTempo;
                            const beatOffset = (noteStartTime - newMeasureStart) / beatLength;
                            
                            // Create a new fraction for the beat offset
                            let beatOffsetFraction;
                            if (Number.isInteger(beatOffset)) {
                                beatOffsetFraction = `new Fraction(${beatOffset}, 1)`;
                            } else {
                                // Convert to a fraction with reasonable precision
                                const fraction = new Fraction(beatOffset);
                                beatOffsetFraction = `new Fraction(${fraction.n}, ${fraction.d})`;
                            }
                            
                            // Create a completely new expression using the new measure as the parent
                            const newRaw = `module.getNoteById(${newMeasure.id}).getVariable('startTime').add(new Fraction(60).div(module.findTempo(module.getNoteById(${newMeasure.id}))).mul(${beatOffsetFraction}))`;
                            
                            // Update the note's startTime
                            depNote.setVariable('startTime', function() {
                                return new Function("module", "Fraction", "return " + newRaw + ";")(myModule, Fraction);
                            });
                            depNote.setVariable('startTimeString', newRaw);
                            
                            console.log(`Relinked note ${depId} to new measure ${newMeasure.id} with beat offset ${beatOffset}`);
                        }
                    });
                }
                
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

        // --- BEGIN ADD NOTE/SILENCE SECTION ---

        if (note !== window.myModule.baseNote && !(measureId !== null)) {
            const addSection = document.createElement('div');
            addSection.className = 'variable-row add-note-section';
            addSection.style.marginBottom = '18px';
            addSection.style.borderTop = '2px solid #00ffcc';

            const addHeader = document.createElement('div');
            addHeader.className = 'variable-name';
            addHeader.style.color = '#00ffcc';
            addHeader.textContent = 'ADD NOTE / SILENCE';
            addHeader.style.marginBottom = '8px';
            addSection.appendChild(addHeader);

            // Mode toggle
            const modeToggleContainer = document.createElement('div');
            modeToggleContainer.style.display = 'flex';
            modeToggleContainer.style.alignItems = 'center';
            modeToggleContainer.style.gap = '10px';
            modeToggleContainer.style.marginBottom = '10px';

            const noteRadio = document.createElement('input');
            noteRadio.type = 'radio';
            noteRadio.name = 'addType';
            noteRadio.value = 'note';
            noteRadio.id = 'addTypeNote';
            noteRadio.checked = true;

            const noteLabel = document.createElement('label');
            noteLabel.textContent = 'Note';
            noteLabel.htmlFor = 'addTypeNote';

            const silenceRadio = document.createElement('input');
            silenceRadio.type = 'radio';
            silenceRadio.name = 'addType';
            silenceRadio.value = 'silence';
            silenceRadio.id = 'addTypeSilence';

            const silenceLabel = document.createElement('label');
            silenceLabel.textContent = 'Silence';
            silenceLabel.htmlFor = 'addTypeSilence';

            modeToggleContainer.appendChild(noteRadio);
            modeToggleContainer.appendChild(noteLabel);
            modeToggleContainer.appendChild(silenceRadio);
            modeToggleContainer.appendChild(silenceLabel);
            addSection.appendChild(modeToggleContainer);

            // At start/end toggle
            const posToggleContainer = document.createElement('div');
            posToggleContainer.style.display = 'flex';
            posToggleContainer.style.alignItems = 'center';
            posToggleContainer.style.gap = '10px';
            posToggleContainer.style.marginBottom = '10px';

            const atStartRadio = document.createElement('input');
            atStartRadio.type = 'radio';
            atStartRadio.name = 'addPos';
            atStartRadio.value = 'start';
            atStartRadio.id = 'addPosStart';

            const atStartLabel = document.createElement('label');
            atStartLabel.textContent = 'At Start';
            atStartLabel.htmlFor = 'addPosStart';

            const atEndRadio = document.createElement('input');
            atEndRadio.type = 'radio';
            atEndRadio.name = 'addPos';
            atEndRadio.value = 'end';
            atEndRadio.id = 'addPosEnd';
            atEndRadio.checked = true;

            const atEndLabel = document.createElement('label');
            atEndLabel.textContent = 'At End';
            atEndLabel.htmlFor = 'addPosEnd';

            posToggleContainer.appendChild(atStartRadio);
            posToggleContainer.appendChild(atStartLabel);
            posToggleContainer.appendChild(atEndRadio);
            posToggleContainer.appendChild(atEndLabel);
            addSection.appendChild(posToggleContainer);

            const noteId = note.id;

            // Frequency row
            const freqRow = document.createElement('div');
            freqRow.className = 'variable-row';
            freqRow.style.padding = '0';
            freqRow.style.marginBottom = '8px';

            const freqNameDiv = document.createElement('div');
            freqNameDiv.className = 'variable-name';
            freqNameDiv.textContent = 'Frequency';
            freqNameDiv.style.fontSize = '13px';

            const freqValueDiv = document.createElement('div');
            freqValueDiv.className = 'variable-value';

            const freqEvalDiv = document.createElement('div');
            freqEvalDiv.className = 'evaluated-value';
            freqEvalDiv.innerHTML = `<span class="value-label">Evaluated:</span> 
                <span id="add-note-freq-eval"></span>`;

            const freqRawDiv = document.createElement('div');
            freqRawDiv.className = 'raw-value';
            freqRawDiv.innerHTML = `<span class="value-label">Raw:</span>`;
            const freqInput = document.createElement('input');
            freqInput.type = 'text';
            freqInput.className = 'raw-value-input';

            // --- Set default frequency formula (parent logic for silences) ---
            let defaultFreqFormula = `new Fraction(1,1).mul(module.getNoteById(${noteId}).getVariable('frequency'))`;
            if (!note.getVariable('frequency')) {
                const parentWithFreq = findParentWithFrequency(note);
                if (parentWithFreq) {
                    defaultFreqFormula = `new Fraction(1,1).mul(module.getNoteById(${parentWithFreq.id}).getVariable('frequency'))`;
                } else {
                    defaultFreqFormula = `new Fraction(1,1).mul(module.baseNote.getVariable('frequency'))`;
                }
            }
            freqInput.value = defaultFreqFormula;

            freqRawDiv.appendChild(freqInput);

            freqValueDiv.appendChild(freqEvalDiv);
            freqValueDiv.appendChild(freqRawDiv);
            freqRow.appendChild(freqNameDiv);
            freqRow.appendChild(freqValueDiv);

            // Duration row
            const durRow = document.createElement('div');
            durRow.className = 'variable-row';
            durRow.style.padding = '0';
            durRow.style.marginBottom = '8px';

            const durNameDiv = document.createElement('div');
            durNameDiv.className = 'variable-name';
            durNameDiv.textContent = 'Duration';
            durNameDiv.style.fontSize = '13px';

            const durValueDiv = document.createElement('div');
            durValueDiv.className = 'variable-value';

            const durEvalDiv = document.createElement('div');
            durEvalDiv.className = 'evaluated-value';
            durEvalDiv.innerHTML = `<span class="value-label">Evaluated:</span> 
                <span id="add-note-dur-eval"></span>`;

            const durRawDiv = document.createElement('div');
            durRawDiv.className = 'raw-value';
            durRawDiv.innerHTML = `<span class="value-label">Raw:</span>`;
            const durInput = document.createElement('input');
            durInput.type = 'text';
            durInput.className = 'raw-value-input';
            // --- Set duration as a literal copy of selected note's durationString ---
            let defaultDurFormula = note.variables.durationString || "new Fraction(1,1)";
            durInput.value = defaultDurFormula;

            durRawDiv.appendChild(durInput);

            durValueDiv.appendChild(durEvalDiv);
            durValueDiv.appendChild(durRawDiv);
            durRow.appendChild(durNameDiv);
            durRow.appendChild(durValueDiv);

            // Start time row
            const stRow = document.createElement('div');
            stRow.className = 'variable-row';
            stRow.style.padding = '0';
            stRow.style.marginBottom = '8px';

            const stNameDiv = document.createElement('div');
            stNameDiv.className = 'variable-name';
            stNameDiv.textContent = 'Start Time';
            stNameDiv.style.fontSize = '13px';

            const stValueDiv = document.createElement('div');
            stValueDiv.className = 'variable-value';

            const stEvalDiv = document.createElement('div');
            stEvalDiv.className = 'evaluated-value';
            stEvalDiv.innerHTML = `<span class="value-label">Evaluated:</span> 
                <span id="add-note-st-eval"></span>`;

            const stRawDiv = document.createElement('div');
            stRawDiv.className = 'raw-value';
            stRawDiv.innerHTML = `<span class="value-label">Raw:</span>`;
            const stInput = document.createElement('input');
            stInput.type = 'text';
            stInput.className = 'raw-value-input';

            function updateStartTimeFormula() {
                let base = `module.getNoteById(${noteId}).getVariable('startTime')`;
                let dur = `module.getNoteById(${noteId}).getVariable('duration')`;
                let autoFormula = atStartRadio.checked
                    ? base
                    : `(${base}).add(${dur})`;
                stInput.value = autoFormula;
                stInput.dispatchEvent(new Event('input'));
            }
            updateStartTimeFormula();

            stInput.addEventListener('input', () => {
                try {
                    const val = new Function("module", "Fraction", "return " + stInput.value + ";")(window.myModule, Fraction);
                    stEvalDiv.querySelector('span#add-note-st-eval').textContent = val.toFraction ? val.toFraction() : val;
                } catch (e) {
                    stEvalDiv.querySelector('span#add-note-st-eval').textContent = "Invalid";
                }
            });

            atStartRadio.addEventListener('change', updateStartTimeFormula);
            atEndRadio.addEventListener('change', updateStartTimeFormula);

            stRawDiv.appendChild(stInput);
            stValueDiv.appendChild(stEvalDiv);
            stValueDiv.appendChild(stRawDiv);
            stRow.appendChild(stNameDiv);
            stRow.appendChild(stValueDiv);

            // Append fields
            addSection.appendChild(freqRow);
            addSection.appendChild(durRow);
            addSection.appendChild(stRow);

            function updateModeFields() {
                if (silenceRadio.checked) {
                    freqRow.style.display = 'none';
                    freqInput.value = '';
                } else {
                    freqRow.style.display = '';
                    if (!freqInput.value) freqInput.value = defaultFreqFormula;
                }
            }
            noteRadio.addEventListener('change', updateModeFields);
            silenceRadio.addEventListener('change', updateModeFields);

            freqInput.addEventListener('input', () => {
                try {
                    const val = new Function("module", "Fraction", "return " + freqInput.value + ";")(window.myModule, Fraction);
                    freqEvalDiv.querySelector('span#add-note-freq-eval').textContent = val.toFraction ? val.toFraction() : val;
                } catch (e) {
                    freqEvalDiv.querySelector('span#add-note-freq-eval').textContent = "Invalid";
                }
            });
            durInput.addEventListener('input', () => {
                try {
                    const val = new Function("module", "Fraction", "return " + durInput.value + ";")(window.myModule, Fraction);
                    durEvalDiv.querySelector('span#add-note-dur-eval').textContent = val.toFraction ? val.toFraction() : val;
                } catch (e) {
                    durEvalDiv.querySelector('span#add-note-dur-eval').textContent = "Invalid";
                }
            });

            // Initial evaluation
            freqInput.dispatchEvent(new Event('input'));
            durInput.dispatchEvent(new Event('input'));
            stInput.dispatchEvent(new Event('input'));

            // --- Create Button ---
            const createBtn = document.createElement('button');
            createBtn.textContent = 'Create Note';
            createBtn.className = 'module-action-btn';
            createBtn.style.marginTop = '10px';
            createBtn.style.background = '#00ffcc';
            createBtn.style.color = '#151525';

            // Helper to replace the parent note id in the frequency formula (for silences)
            function replaceFrequencyParentInFormula(formula, newParentId) {
                return formula.replace(
                    /\.mul\s*\(\s*module\.getNoteById\(\s*\d+\s*\)\.getVariable\('frequency'\)\s*\)/,
                    `.mul(module.getNoteById(${newParentId}).getVariable('frequency'))`
                );
            }

            createBtn.addEventListener('click', () => {
                try {
                    let freqFormula = freqInput.value;
                    let durFormula = durInput.value; // Use as literal
                    let stFormula = stInput.value;

                    let isSilence = silenceRadio.checked;
                    let variables = {};

                    variables.startTime = function() {
                        return new Function("module", "Fraction", "return " + stFormula + ";")(window.myModule, Fraction);
                    };
                    variables.startTimeString = stFormula;

                    // Duration: use as literal (no dependency rewrite)
                    variables.duration = function() {
                        return new Function("module", "Fraction", "return " + durFormula + ";")(window.myModule, Fraction);
                    };
                    variables.durationString = durFormula;

                    // --- COLOR + FREQUENCY LOGIC ---
                    let colorToUse = null;
                    let freqFormulaToUse = freqFormula;
                    if (!isSilence) {
                        // If the selected note is a silence, use its parent for frequency/color
                        if (!note.getVariable('frequency')) {
                            const parentWithFreq = findParentWithFrequency(note);
                            if (parentWithFreq) {
                                freqFormulaToUse = replaceFrequencyParentInFormula(freqFormula, parentWithFreq.id);
                                if (parentWithFreq.variables && parentWithFreq.variables.color) {
                                    colorToUse = parentWithFreq.variables.color;
                                }
                            } else {
                                freqFormulaToUse = replaceFrequencyParentInFormula(freqFormula, 0);
                            }
                        } else {
                            if (note.variables && note.variables.color) {
                                colorToUse = note.variables.color;
                            }
                        }
                        variables.frequency = function() {
                            return new Function("module", "Fraction", "return " + freqFormulaToUse + ";")(window.myModule, Fraction);
                        };
                        variables.frequencyString = freqFormulaToUse;
                    } else {
                        // For silence, inherit color from parent with frequency
                        const parentWithFreq = findParentWithFrequency(note);
                        if (parentWithFreq && parentWithFreq.variables && parentWithFreq.variables.color) {
                            colorToUse = parentWithFreq.variables.color;
                        }
                    }
                    if (colorToUse) {
                        variables.color = colorToUse;
                    }

                    // Add the note to the module
                    const newNote = window.myModule.addNote(variables);

                    // Only mark the new note as dirty
                    if (typeof window.myModule.markNoteDirty === 'function') {
                        window.myModule.markNoteDirty(newNote.id);
                    }

                    window.evaluatedNotes = window.myModule.evaluateModule();
                    if (typeof externalFunctions.updateVisualNotes === 'function') {
                        externalFunctions.updateVisualNotes(window.evaluatedNotes);
                    }
                    if (typeof externalFunctions.createMeasureBars === 'function') {
                        externalFunctions.createMeasureBars();
                    }

                    // Show the new note in the widget
                    const newElem = document.querySelector(`.note-content[data-note-id="${newNote.id}"]`);
                    if (newElem && window.modals && typeof window.modals.showNoteVariables === 'function') {
                        window.modals.showNoteVariables(newNote, newElem);
                    }

                } catch (err) {
                    alert("Error creating note: " + err.message);
                }
            });

            addSection.appendChild(createBtn);

            // Insert before the evaluate section
            widgetContent.appendChild(addSection);
        }

        // --- END ADD NOTE/SILENCE SECTION ---
        
        // Add the evaluate section for notes and measure bars
        if (note !== window.myModule.baseNote) {
            const evaluateWrapper = document.createElement('div');
            evaluateWrapper.className = 'evaluate-note-row';
            
            const evaluateHeader = document.createElement('div');
            evaluateHeader.className = 'evaluate-note-header';
            evaluateHeader.textContent = 'EVALUATE';
            
            evaluateWrapper.appendChild(evaluateHeader);
            
            // Check if this is a measure bar (has startTime but no duration)
            const isMeasureBar = note.variables.startTime && !note.variables.duration;
            
            // Only add the Liberate Dependencies button for non-measure bar notes
            if (!isMeasureBar) {
                // Add the Liberate Dependencies button
                const liberateButton = document.createElement('button');
                liberateButton.className = 'evaluate-note-btn liberate-dependencies';
                liberateButton.textContent = 'Liberate Dependencies';
                
                liberateButton.addEventListener('click', function() {
                    showLiberateConfirmation(effectiveNoteId);
                });
                
                evaluateWrapper.appendChild(liberateButton);
            }
            
            const evaluateButton = document.createElement('button');
            evaluateButton.className = 'evaluate-note-btn';
            evaluateButton.textContent = 'Evaluate to BaseNote';
            
            evaluateButton.addEventListener('click', function() {
                showEvaluateConfirmation(effectiveNoteId);
            });
            
            evaluateWrapper.appendChild(evaluateButton);
            
            widgetContent.appendChild(evaluateWrapper);
        }

        // --- BEGIN ADD NOTE/SILENCE SECTION FOR BASENOTE ---
        if (note === window.myModule.baseNote) {
            const addSection = document.createElement('div');
            addSection.className = 'variable-row add-note-section';
            addSection.style.marginBottom = '18px';
            addSection.style.borderTop = '2px solid #00ffcc';

            const addHeader = document.createElement('div');
            addHeader.className = 'variable-name';
            addHeader.style.color = '#00ffcc';
            addHeader.textContent = 'ADD NOTE / SILENCE';
            addHeader.style.marginBottom = '8px';
            addSection.appendChild(addHeader);

            // Mode toggle: Note or Silence
            const modeToggleContainer = document.createElement('div');
            modeToggleContainer.style.display = 'flex';
            modeToggleContainer.style.alignItems = 'center';
            modeToggleContainer.style.gap = '10px';
            modeToggleContainer.style.marginBottom = '10px';

            const noteRadio = document.createElement('input');
            noteRadio.type = 'radio';
            noteRadio.name = 'addTypeBase';
            noteRadio.value = 'note';
            noteRadio.id = 'addTypeBaseNote';
            noteRadio.checked = true;

            const noteLabel = document.createElement('label');
            noteLabel.textContent = 'Note';
            noteLabel.htmlFor = 'addTypeBaseNote';

            const silenceRadio = document.createElement('input');
            silenceRadio.type = 'radio';
            silenceRadio.name = 'addTypeBase';
            silenceRadio.value = 'silence';
            silenceRadio.id = 'addTypeBaseSilence';

            const silenceLabel = document.createElement('label');
            silenceLabel.textContent = 'Silence';
            silenceLabel.htmlFor = 'addTypeBaseSilence';

            modeToggleContainer.appendChild(noteRadio);
            modeToggleContainer.appendChild(noteLabel);
            modeToggleContainer.appendChild(silenceRadio);
            modeToggleContainer.appendChild(silenceLabel);
            addSection.appendChild(modeToggleContainer);

            // Frequency row
            const freqRow = document.createElement('div');
            freqRow.className = 'variable-row';
            freqRow.style.padding = '0';
            freqRow.style.marginBottom = '8px';

            const freqNameDiv = document.createElement('div');
            freqNameDiv.className = 'variable-name';
            freqNameDiv.textContent = 'Frequency';
            freqNameDiv.style.fontSize = '13px';

            const freqValueDiv = document.createElement('div');
            freqValueDiv.className = 'variable-value';

            const freqEvalDiv = document.createElement('div');
            freqEvalDiv.className = 'evaluated-value';
            freqEvalDiv.innerHTML = `<span class="value-label">Evaluated:</span> 
                <span id="add-note-freq-eval"></span>`;

            const freqRawDiv = document.createElement('div');
            freqRawDiv.className = 'raw-value';
            freqRawDiv.innerHTML = `<span class="value-label">Raw:</span>`;
            const freqInput = document.createElement('input');
            freqInput.type = 'text';
            freqInput.className = 'raw-value-input';
            freqInput.value = `new Fraction(1,1).mul(module.baseNote.getVariable('frequency'))`;
            freqRawDiv.appendChild(freqInput);

            freqValueDiv.appendChild(freqEvalDiv);
            freqValueDiv.appendChild(freqRawDiv);
            freqRow.appendChild(freqNameDiv);
            freqRow.appendChild(freqValueDiv);

            // Duration row
            const durRow = document.createElement('div');
            durRow.className = 'variable-row';
            durRow.style.padding = '0';
            durRow.style.marginBottom = '8px';

            const durNameDiv = document.createElement('div');
            durNameDiv.className = 'variable-name';
            durNameDiv.textContent = 'Duration';
            durNameDiv.style.fontSize = '13px';

            const durValueDiv = document.createElement('div');
            durValueDiv.className = 'variable-value';

            const durEvalDiv = document.createElement('div');
            durEvalDiv.className = 'evaluated-value';
            durEvalDiv.innerHTML = `<span class="value-label">Evaluated:</span> 
                <span id="add-note-dur-eval"></span>`;

            const durRawDiv = document.createElement('div');
            durRawDiv.className = 'raw-value';
            durRawDiv.innerHTML = `<span class="value-label">Raw:</span>`;
            const durInput = document.createElement('input');
            durInput.type = 'text';
            durInput.className = 'raw-value-input';
            durInput.value = `new Fraction(60).div(module.baseNote.getVariable('tempo'))`; // 1 beat at current tempo
            durRawDiv.appendChild(durInput);

            durValueDiv.appendChild(durEvalDiv);
            durValueDiv.appendChild(durRawDiv);
            durRow.appendChild(durNameDiv);
            durRow.appendChild(durValueDiv);

            // Start time row
            const stRow = document.createElement('div');
            stRow.className = 'variable-row';
            stRow.style.padding = '0';
            stRow.style.marginBottom = '8px';

            const stNameDiv = document.createElement('div');
            stNameDiv.className = 'variable-name';
            stNameDiv.textContent = 'Start Time';
            stNameDiv.style.fontSize = '13px';

            const stValueDiv = document.createElement('div');
            stValueDiv.className = 'variable-value';

            const stEvalDiv = document.createElement('div');
            stEvalDiv.className = 'evaluated-value';
            stEvalDiv.innerHTML = `<span class="value-label">Evaluated:</span> 
                <span id="add-note-st-eval"></span>`;

            const stRawDiv = document.createElement('div');
            stRawDiv.className = 'raw-value';
            stRawDiv.innerHTML = `<span class="value-label">Raw:</span>`;
            const stInput = document.createElement('input');
            stInput.type = 'text';
            stInput.className = 'raw-value-input';
            stInput.value = `module.baseNote.getVariable('startTime')`;
            stRawDiv.appendChild(stInput);

            stValueDiv.appendChild(stEvalDiv);
            stValueDiv.appendChild(stRawDiv);
            stRow.appendChild(stNameDiv);
            stRow.appendChild(stValueDiv);

            // Append fields
            addSection.appendChild(freqRow);
            addSection.appendChild(durRow);
            addSection.appendChild(stRow);

            // Toggle frequency row for silence
            function updateModeFields() {
                if (silenceRadio.checked) {
                    freqRow.style.display = 'none';
                    freqInput.value = '';
                } else {
                    freqRow.style.display = '';
                    if (!freqInput.value) freqInput.value = `new Fraction(1,1).mul(module.baseNote.getVariable('frequency'))`;
                }
            }
            noteRadio.addEventListener('change', updateModeFields);
            silenceRadio.addEventListener('change', updateModeFields);

            freqInput.addEventListener('input', () => {
                try {
                    const val = new Function("module", "Fraction", "return " + freqInput.value + ";")(window.myModule, Fraction);
                    freqEvalDiv.querySelector('span#add-note-freq-eval').textContent = val.toFraction ? val.toFraction() : val;
                } catch (e) {
                    freqEvalDiv.querySelector('span#add-note-freq-eval').textContent = "Invalid";
                }
            });
            durInput.addEventListener('input', () => {
                try {
                    const val = new Function("module", "Fraction", "return " + durInput.value + ";")(window.myModule, Fraction);
                    durEvalDiv.querySelector('span#add-note-dur-eval').textContent = val.toFraction ? val.toFraction() : val;
                } catch (e) {
                    durEvalDiv.querySelector('span#add-note-dur-eval').textContent = "Invalid";
                }
            });
            stInput.addEventListener('input', () => {
                try {
                    const val = new Function("module", "Fraction", "return " + stInput.value + ";")(window.myModule, Fraction);
                    stEvalDiv.querySelector('span#add-note-st-eval').textContent = val.toFraction ? val.toFraction() : val;
                } catch (e) {
                    stEvalDiv.querySelector('span#add-note-st-eval').textContent = "Invalid";
                }
            });

            // Initial evaluation
            freqInput.dispatchEvent(new Event('input'));
            durInput.dispatchEvent(new Event('input'));
            stInput.dispatchEvent(new Event('input'));

            // --- Create Button ---
            const createBtn = document.createElement('button');
            createBtn.textContent = 'Create';
            createBtn.className = 'module-action-btn';
            createBtn.style.marginTop = '10px';
            createBtn.style.background = '#00ffcc';
            createBtn.style.color = '#151525';

            createBtn.addEventListener('click', () => {
                try {
                    // Pause playback if necessary
                    if (window.playerState && window.playerState.isPlaying && !window.playerState.isPaused &&
                        window.playerControls && window.playerControls.pause) {
                        window.playerControls.pause();
                    }

                    let freqFormula = freqInput.value;
                    let durFormula = durInput.value;
                    let stFormula = stInput.value;

                    let isSilence = silenceRadio.checked;
                    let variables = {};

                    variables.startTime = function() {
                        return new Function("module", "Fraction", "return " + stFormula + ";")(window.myModule, Fraction);
                    };
                    variables.startTimeString = stFormula;

                    variables.duration = function() {
                        return new Function("module", "Fraction", "return " + durFormula + ";")(window.myModule, Fraction);
                    };
                    variables.durationString = durFormula;

                    if (!isSilence) {
                        variables.frequency = function() {
                            return new Function("module", "Fraction", "return " + freqFormula + ";")(window.myModule, Fraction);
                        };
                        variables.frequencyString = freqFormula;
                    }

                    // Always assign a random color
                    const hue = Math.floor(Math.random() * 360);
                    variables.color = `hsla(${hue}, 70%, 60%, 0.7)`;

                    // Add the note to the module
                    const newNote = window.myModule.addNote(variables);

                    // Only mark the new note as dirty
                    if (typeof window.myModule.markNoteDirty === 'function') {
                        window.myModule.markNoteDirty(newNote.id);
                    }

                    window.evaluatedNotes = window.myModule.evaluateModule();
                    if (typeof externalFunctions.updateVisualNotes === 'function') {
                        externalFunctions.updateVisualNotes(window.evaluatedNotes);
                    }
                    if (typeof externalFunctions.createMeasureBars === 'function') {
                        externalFunctions.createMeasureBars();
                    }

                    // Show the new note in the widget
                    const newElem = document.querySelector(`.note-content[data-note-id="${newNote.id}"]`);
                    if (newElem && window.modals && typeof window.modals.showNoteVariables === 'function') {
                        window.modals.showNoteVariables(newNote, newElem);
                    }

                } catch (err) {
                    alert("Error creating note: " + err.message);
                }
            });

            addSection.appendChild(createBtn);

            // Insert before the evaluate section
            widgetContent.appendChild(addSection);
        }
        // --- END ADD NOTE/SILENCE SECTION FOR BASENOTE ---
        
        // Add evaluate module button for base note
        if (note === window.myModule.baseNote) {
            const evaluateWrapper = document.createElement('div');
            evaluateWrapper.className = 'evaluate-note-row';
            
            const evaluateHeader = document.createElement('div');
            evaluateHeader.className = 'evaluate-note-header';
            evaluateHeader.textContent = 'EVALUATE';
            
            const evaluateButton = document.createElement('button');
            evaluateButton.className = 'evaluate-note-btn';
            evaluateButton.textContent = 'Evaluate Module';
            
            evaluateButton.addEventListener('click', function() {
                showEvaluateModuleConfirmation();
            });
            
            evaluateWrapper.appendChild(evaluateHeader);
            evaluateWrapper.appendChild(evaluateButton);
            
            widgetContent.appendChild(evaluateWrapper);
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
    
    // Add confirmation modal for liberating a note
    function showLiberateConfirmation(noteId) {
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
            // Pause playback if it's active
            if (window.playerState && window.playerState.isPlaying && !window.playerState.isPaused && window.playerControls && window.playerControls.pause) {
                window.playerControls.pause();
            }
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
    
        // When clicking outside modal, only remove overlay without affecting selection.
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) {
                e.stopPropagation();
                document.body.removeChild(overlay);
            }
        });
    
        document.body.appendChild(overlay);
    }

    // Add confirmation modal for evaluation
    function showEvaluateConfirmation(noteId) {
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
            // Pause playback if it's active
            if (window.playerState && window.playerState.isPlaying && !window.playerState.isPaused && window.playerControls && window.playerControls.pause) {
                window.playerControls.pause();
            }
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
    
        // When clicking outside modal, only remove overlay without affecting selection.
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) {
                e.stopPropagation();
                document.body.removeChild(overlay);
            }
        });
    
        document.body.appendChild(overlay);
    }

    function showEvaluateModuleConfirmation() {
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
            // Pause playback if it's active
            if (window.playerState && window.playerState.isPlaying && !window.playerState.isPaused && window.playerControls && window.playerControls.pause) {
                window.playerControls.pause();
            }
            // Call evaluateEntireModule instead of evaluateNoteToBaseNote
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

    // Utility function: Balance parentheses in an expression
    function balanceParentheses(expr) {
        let openCount = 0;
        for (const char of expr) {
        if (char === '(') openCount++;
        else if (char === ')') openCount--;
        }
        // If there are extra open parentheses, append the needed closing ones.
        if (openCount > 0) {
        expr += ')'.repeat(openCount);
        }
        // If there are extra closing parentheses, remove them from the end.
        if (openCount < 0) {
        while (openCount < 0 && expr.endsWith(')')) {
            expr = expr.slice(0, -1);
            openCount++;
        }
        }
        return expr;
    }
    
    // Function to evaluate a note to base note with iterative simplification and cleanup of extra parentheses
    function evaluateNoteToBaseNote(noteId) {
        const note = window.myModule.getNoteById(parseInt(noteId, 10));
        if (!note) {
            console.error("Note not found:", noteId);
            return;
        }
        
        // Store the currently selected note for later
        const currentSelectedNote = note;
        
        // Process each variable that might have dependencies
        const variablesToProcess = ['startTime', 'duration', 'frequency'];
        let success = true;
        const MAX_ITERATIONS = 15; // Increased to handle more complex expressions
        
        variablesToProcess.forEach(varName => {
            if (!note.variables[varName + 'String']) return;
            
            let currentRawExpr = note.variables[varName + 'String'];
            let newRawExpr = currentRawExpr;
            let iterations = 0;
            
            // Iteratively simplify until no changes occur or max iterations reached
            do {
                currentRawExpr = newRawExpr;
                if (currentRawExpr.indexOf("module.getNoteById(") === -1) break;
                newRawExpr = replaceNoteReferencesWithBaseNoteOnly(currentRawExpr, window.myModule);
                iterations++;
            } while (currentRawExpr !== newRawExpr && iterations < MAX_ITERATIONS);
            
            // Clean up extra parentheses
            newRawExpr = removeExcessParentheses(newRawExpr);
            // Balance parentheses
            newRawExpr = balanceParentheses(newRawExpr);
            
            // If we still have getNoteById references after all iterations, try a direct approach
            // This is a fallback for complex cases
            if (newRawExpr.indexOf("module.getNoteById(") !== -1) {
                // Try to evaluate the expression directly
                try {
                    const originalValue = note.getVariable(varName).valueOf();
                    
                    // Create a direct expression using the evaluated value
                    if (varName === 'startTime') {
                        newRawExpr = `module.baseNote.getVariable('startTime').add(new Fraction(${originalValue}))`;
                    } else if (varName === 'duration') {
                        newRawExpr = `new Fraction(${originalValue})`;
                    } else if (varName === 'frequency') {
                        const baseFreq = window.myModule.baseNote.getVariable('frequency').valueOf();
                        const ratio = originalValue / baseFreq;
                        newRawExpr = `new Fraction(${ratio}).mul(module.baseNote.getVariable('frequency'))`;
                    }
                } catch (error) {
                    console.error(`Error creating direct expression for ${varName}:`, error);
                    return; // Skip updating this variable
                }
            }
            
            try {
                // Test the simplified expression
                const testFunc = new Function("module", "Fraction", "return " + newRawExpr + ";");
                const testResult = testFunc(window.myModule, Fraction);
                const originalValue = note.getVariable(varName).valueOf();
                const newValue = testResult.valueOf();
                
                if (Math.abs(originalValue - newValue) > 0.0001) {
                    return; // Skip updating this variable
                }
                
                // Update the note's variable
                note.setVariable(varName, function() {
                    return new Function("module", "Fraction", "return " + newRawExpr + ";")(window.myModule, Fraction);
                });
                note.setVariable(varName + 'String', newRawExpr);
            } catch (error) {
                console.error(`Error evaluating ${varName} for note ${noteId}:`, error);
                success = false;
            }
        });
        
        // Recompile this note and its dependents
        recompileNoteAndDependents(note.id);
        window.myModule.markNoteDirty(note.id);
        window.evaluatedNotes = window.myModule.evaluateModule();
        externalFunctions.updateVisualNotes(window.evaluatedNotes);
        
        // Find the new element for the note after DOM update
        const newElem = document.querySelector(`.note-content[data-note-id="${noteId}"]`);
        
        // Re-apply the bring to front functionality for the selected note
        if (currentSelectedNote && currentSelectedNote.id !== 0 && newElem) {
            // Only bring to front if it's not the base note
            if (externalFunctions.bringSelectedNoteToFront) {
                externalFunctions.bringSelectedNoteToFront(currentSelectedNote, newElem);
            }
        }
        
        // Now show the note variables (which will also mark it as selected)
        showNoteVariables(currentSelectedNote, newElem);
        
        if (success) {
            showNotification('Note evaluated successfully!', 'success');
        }
    }
    
    // Function to replace references to other notes with their expressions
    // This will recursively replace references until only base note references remain
    function replaceNoteReferencesWithBaseNoteOnly(expr, moduleInstance) {
        // Regular expressions for matching note references and helper calls
        const measureLengthRegex = /module\.findMeasureLength\(module\.getNoteById\((\d+)\)\)/g;
        const tempoRegex = /module\.findTempo\(module\.getNoteById\((\d+)\)\)/g;
        
        // NEW: Pattern for the formula created when dragging notes
        const draggedNotePattern = /module\.getNoteById\((\d+)\)\.getVariable\('startTime'\)\.add\(new Fraction\(60\)\.div\(module\.findTempo\(module\.getNoteById\(\d+\)\)\)\.mul\(new Fraction\(([^,]+),\s*([^)]+)\)\)\)/g;
        
        let prevExpr = '';
        let currentExpr = expr;
        let iterations = 0;
        const MAX_ITERATIONS = 10;
        
        while (prevExpr !== currentExpr && iterations < MAX_ITERATIONS) {
            prevExpr = currentExpr;
            iterations++;
            
            // Replace measure length references
            currentExpr = currentExpr.replace(measureLengthRegex, () => {
                return 'module.findMeasureLength(module.baseNote)';
            });
            
            // Replace tempo references
            currentExpr = currentExpr.replace(tempoRegex, () => {
                return 'module.findTempo(module.baseNote)';
            });
            
            // NEW: Handle the dragged note pattern
            currentExpr = currentExpr.replace(draggedNotePattern, (match, noteId, numerator, denominator) => {
                const refNote = moduleInstance.getNoteById(parseInt(noteId, 10));
                if (!refNote) return match;
                
                // Get the reference note's start time
                const refStartTime = refNote.getVariable('startTime').valueOf();
                
                // Calculate the beat offset
                const baseTempo = moduleInstance.baseNote.getVariable('tempo').valueOf();
                const beatLength = 60 / baseTempo;
                const beatOffset = new Fraction(numerator, denominator).valueOf();
                
                // Calculate the absolute time
                const absoluteTime = refStartTime + (beatOffset * beatLength);
                
                // Create a direct expression using the base note
                const baseStartTime = moduleInstance.baseNote.getVariable('startTime').valueOf();
                const offset = absoluteTime - baseStartTime;
                
                // Convert to beats
                const offsetBeats = offset / beatLength;
                
                // Create the new expression
                return `module.baseNote.getVariable('startTime').add(new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(${offsetBeats})))`;
            });
            
            // Replace note references
            const noteRefRegex = /module\.getNoteById\((\d+)\)\.getVariable\('([^']+)'\)/g;
            
            // Create a new expression by replacing each match
            let newExpr = '';
            let lastIndex = 0;
            let match;
            
            // Reset the regex
            const regex = new RegExp(noteRefRegex);
            
            while ((match = regex.exec(currentExpr)) !== null) {
                // Add text before this match
                newExpr += currentExpr.substring(lastIndex, match.index);
                
                // Process the match
                const noteId = match[1];
                const varName = match[2];
                
                // Base note reference
                if (noteId === '0') {
                    newExpr += `module.baseNote.getVariable('${varName}')`;
                } else {
                    const refNote = moduleInstance.getNoteById(parseInt(noteId, 10));
                    if (!refNote) {
                        newExpr += match[0]; // Keep original if note not found
                    } else {
                        // Get the raw expression
                        const rawExpr = refNote.variables[varName + 'String'] || '';
                        if (!rawExpr) {
                            newExpr += match[0]; // Keep original if no raw expression
                        } else {
                            // If the raw expression directly references the base note
                            if (rawExpr === "module.baseNote.getVariable('startTime')") {
                                newExpr += `module.baseNote.getVariable('${varName}')`;
                            } else {
                                // Otherwise, use the raw expression wrapped in parentheses
                                newExpr += `(${rawExpr})`;
                            }
                        }
                    }
                }
                
                // Update lastIndex to after this match
                lastIndex = match.index + match[0].length;
            }
            
            // Add any remaining text
            newExpr += currentExpr.substring(lastIndex);
            
            // Update currentExpr if we made changes
            if (newExpr !== currentExpr) {
                currentExpr = newExpr;
            }
        }
        
        // Final replacement: any occurrence of module.getNoteById(0) should be replaced with module.baseNote
        currentExpr = currentExpr.replace(/module\.getNoteById\(0\)/g, 'module.baseNote');
        
        // Apply further expression simplifications
        return simplifyExpressions(currentExpr);
    }

    function simplifyExpressions(expr) {
        try {
            // Remove excess parentheses
            let simplified = removeExcessParentheses(expr);
            
            // Simplify frequency expressions
            if (simplified.includes("module.baseNote.getVariable('frequency')")) {
                simplified = simplifyFrequencyExpression(simplified);
            }
            
            // Simplify duration expressions
            if (simplified.includes("new Fraction(60).div(module.findTempo") && 
                !simplified.includes("module.baseNote.getVariable('startTime')")) {
                simplified = simplifyDurationExpression(simplified);
            }
            
            // Simplify startTime expressions - this is the most complex case
            if (simplified.includes("module.baseNote.getVariable('startTime')")) {
                simplified = simplifyStartTimeExpression(simplified);
            }
            
            // Final cleanup of parentheses
            simplified = removeExcessParentheses(simplified);
            
            return simplified;
        } catch (error) {
            console.error("Error in simplifyExpressions:", error);
            return expr; // Return original if simplification fails
        }
    }
    
    // Remove excess parentheses
    function removeExcessParentheses(expr) {
        let result = expr;
        let prev = '';
        
        // Replace ((x)) with (x) repeatedly until no more changes
        while (prev !== result) {
            prev = result;
            result = result.replace(/\(\(([^()]*)\)\)/g, '($1)');
        }
        
        return result;
    }
    
    // Simplify frequency expressions like new Fraction(a,b).mul(new Fraction(c,d).mul(module.baseNote.getVariable('frequency')))
    function simplifyFrequencyExpression(expr) {
        try {
            // Check if this is a frequency expression with multiple fractions
            if (!expr.includes("module.baseNote.getVariable('frequency')") || !expr.includes("new Fraction")) {
                return expr;
            }
            
            // Extract all fractions
            const fractions = [];
            const fractionRegex = /new\s+Fraction\((\d+),\s*(\d+)\)/g;
            let match;
            
            while ((match = fractionRegex.exec(expr)) !== null) {
                fractions.push({
                    n: parseInt(match[1], 10),
                    d: parseInt(match[2], 10)
                });
            }
            
            // If we have multiple fractions, combine them
            if (fractions.length > 1) {
                let resultN = 1;
                let resultD = 1;
                
                fractions.forEach(frac => {
                    resultN *= frac.n;
                    resultD *= frac.d;
                });
                
                // Simplify the fraction using GCD
                const gcd = findGCD(resultN, resultD);
                resultN /= gcd;
                resultD /= gcd;
                
                // Create a new expression with the simplified fraction
                return `new Fraction(${resultN}, ${resultD}).mul(module.baseNote.getVariable('frequency'))`;
            }
        } catch (error) {
            console.error("Error simplifying frequency expression:", error);
        }
        
        return expr;
    }

    // Simplify duration expressions like new Fraction(60).div(module.findTempo(module.baseNote)).mul(X)
    function simplifyDurationExpression(expr) {
        try {
            // Check if this is a simple tempo-based duration expression
            const simpleDurationPattern = /^new\s+Fraction\(60\)\.div\(module\.findTempo\(module\.baseNote\)\)\.mul\(([^)]+)\)$/;
            const match = expr.match(simpleDurationPattern);
            
            if (match) {
                // This is already a simple duration expression, no need to simplify
                return expr;
            }
            
            // If it's a more complex expression with multiple tempo terms, try to simplify
            const tempoTerms = [];
            const tempoRegex = /new\s+Fraction\(60\)\.div\(module\.findTempo\(module\.baseNote\)\)\.mul\(([^)]+)\)/g;
            let tempMatch;
            
            while ((tempMatch = tempoRegex.exec(expr)) !== null) {
                const multiplier = parseFloat(tempMatch[1]);
                if (!isNaN(multiplier)) {
                    tempoTerms.push({
                        term: tempMatch[0],
                        multiplier: multiplier
                    });
                }
            }
            
            // If we have multiple tempo terms, combine them
            if (tempoTerms.length > 1) {
                // Calculate the sum of multipliers
                const totalMultiplier = tempoTerms.reduce((sum, term) => sum + term.multiplier, 0);
                
                // Check if the expression is a simple addition of tempo terms
                const isSimpleAddition = expr.replace(/new\s+Fraction\(60\)\.div\(module\.findTempo\(module\.baseNote\)\)\.mul\([^)]+\)/g, '')
                                        .replace(/\.\s*add\s*\(/g, '')
                                        .replace(/\)/g, '')
                                        .trim() === '';
                
                if (isSimpleAddition) {
                    // Create a new expression with the combined term
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
            // First, normalize the expression by removing all unnecessary parentheses
            let normalizedExpr = expr.replace(/\(\(/g, '(').replace(/\)\)/g, ')');
            while (normalizedExpr !== expr) {
                expr = normalizedExpr;
                normalizedExpr = expr.replace(/\(\(/g, '(').replace(/\)\)/g, ')');
            }
            
            // Parse the expression into a tree structure
            function parseExpr(e) {
                // Base case: this is a simple term
                if (!e.includes('.add(')) {
                    return { type: 'term', value: e };
                }
                
                // Find the outermost .add() call
                let depth = 0;
                let addIndex = -1;
                for (let i = 0; i < e.length - 4; i++) {
                    if (e[i] === '(') depth++;
                    else if (e[i] === ')') depth--;
                    
                    if (depth === 0 && e.substring(i, i+5) === '.add(') {
                        addIndex = i;
                        break;
                    }
                }
                
                if (addIndex === -1) {
                    return { type: 'term', value: e };
                }
                
                const left = e.substring(0, addIndex);
                
                // Find the matching closing parenthesis
                depth = 1;
                let closeIndex = -1;
                for (let i = addIndex + 5; i < e.length; i++) {
                    if (e[i] === '(') depth++;
                    else if (e[i] === ')') {
                        depth--;
                        if (depth === 0) {
                            closeIndex = i;
                            break;
                        }
                    }
                }
                
                if (closeIndex === -1) {
                    return { type: 'term', value: e };
                }
                
                const right = e.substring(addIndex + 5, closeIndex);
                
                return {
                    type: 'add',
                    left: parseExpr(left),
                    right: parseExpr(right)
                };
            }
            
            // Analyze the parsed tree to extract terms
            function analyzeTree(node) {
                const result = {
                    baseStartTime: false,
                    measureTerms: [],
                    tempoTerms: []
                };
                
                if (node.type === 'term') {
                    const term = node.value;
                    
                    // Check if this is the base startTime
                    if (term.includes("module.baseNote.getVariable('startTime')") && 
                        !term.includes('.add(')) {
                        result.baseStartTime = true;
                    }
                    
                    // Check if this is a measure length term with multiplier
                    const complexMeasureMatch = term.match(/new\s+Fraction\((\d+)\)\.mul\(module\.findMeasureLength\(module\.baseNote\)\)/);
                    if (complexMeasureMatch) {
                        const multiplier = parseInt(complexMeasureMatch[1], 10);
                        if (!isNaN(multiplier)) {
                            result.measureTerms.push(multiplier);
                        }
                    }
                    
                    // Check if this is a simple measure length term
                    else if (term === 'module.findMeasureLength(module.baseNote)') {
                        result.measureTerms.push(1);
                    }
                    
                    // Check if this is a tempo term with multiplier
                    const complexTempoMatch = term.match(/new\s+Fraction\(60\)\.div\(module\.findTempo\(module\.baseNote\)\)\.mul\(([^)]+)\)/);
                    if (complexTempoMatch) {
                        const multiplier = parseFloat(complexTempoMatch[1]);
                        if (!isNaN(multiplier)) {
                            result.tempoTerms.push(multiplier);
                        }
                    }
                    
                    // Check if this is a simple tempo term
                    else if (term === 'new Fraction(60).div(module.findTempo(module.baseNote))') {
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
            
            // Parse and analyze the expression
            const parsedExpr = parseExpr(normalizedExpr);
            const analysis = analyzeTree(parsedExpr);
            
            console.log("Expression analysis:", analysis);
            
            // Only proceed if we have the base startTime and some terms to simplify
            if (analysis.baseStartTime && 
                (analysis.measureTerms.length > 0 || analysis.tempoTerms.length > 0)) {
                
                // Build the new expression
                let newExpr = "module.baseNote.getVariable('startTime')";
                
                // Add measure length term if needed
                if (analysis.measureTerms.length > 0) {
                    const totalMeasures = analysis.measureTerms.reduce((sum, val) => sum + val, 0);
                    if (totalMeasures === 1) {
                        newExpr += ".add(module.findMeasureLength(module.baseNote))";
                    } else {
                        newExpr += `.add(new Fraction(${totalMeasures}).mul(module.findMeasureLength(module.baseNote)))`;
                    }
                }
                
                // Add tempo term if needed
                if (analysis.tempoTerms.length > 0) {
                    const totalMultiplier = analysis.tempoTerms.reduce((sum, val) => sum + val, 0);
                    if (totalMultiplier === 1) {
                        newExpr += `.add(new Fraction(60).div(module.findTempo(module.baseNote)))`;
                    } else {
                        newExpr += `.add(new Fraction(60).div(module.findTempo(module.baseNote)).mul(${totalMultiplier}))`;
                    }
                }
                
                console.log("New expression from tree parsing:", newExpr);
                
                // Test the new expression to make sure it evaluates to the same value
                try {
                    const originalFunc = new Function("module", "Fraction", "return " + expr + ";");
                    const newFunc = new Function("module", "Fraction", "return " + newExpr + ";");
                    
                    const originalValue = originalFunc(window.myModule, Fraction).valueOf();
                    const newValue = newFunc(window.myModule, Fraction).valueOf();
                    
                    console.log("Original value:", originalValue);
                    console.log("New value:", newValue);
                    
                    // If the values are the same (within a small tolerance), return the simplified expression
                    if (Math.abs(originalValue - newValue) < 0.0001) {
                        console.log("Tree-based simplification successful!");
                        return newExpr;
                    } else {
                        console.warn(`Tree-based simplification would change value from ${originalValue} to ${newValue}, keeping original`);
                    }
                } catch (evalError) {
                    console.error("Error evaluating expressions in tree-based approach:", evalError);
                }
            }
        } catch (error) {
            console.error("Error in tree-based simplification:", error);
        }
        
        return expr;
    }
    
    // Update the main simplifyStartTimeExpression function to try both approaches:
    function simplifyStartTimeExpression(expr) {
        try {
            // First try the regex-based approach
            const regexResult = simplifyStartTimeExpressionWithRegex(expr);
            
            // If the regex approach didn't simplify the expression, try the tree-based approach
            if (regexResult === expr) {
                return parseAndSimplifyExpression(expr);
            }
            
            return regexResult;
        } catch (error) {
            console.error("Error in simplifyStartTimeExpression:", error);
            return expr;
        }
    }
    
    // Simplify startTime expressions with multiple add operations
    function simplifyStartTimeExpressionWithRegex(expr) {
        try {
            // First, let's do a basic check to see if this is a startTime expression
            if (!expr.includes("module.baseNote.getVariable('startTime')")) {
                return expr;
            }
            
            console.log("Simplifying:", expr);
            
            // Extract all measure length terms, including those with multipliers
            const measureTerms = [];
            
            // Match measure length terms with multipliers first
            const complexMeasureRegex = /new\s+Fraction\((\d+)\)\.mul\(module\.findMeasureLength\(module\.baseNote\)\)/g;
            let complexMeasureMatch;
            let tempExpr = expr;
            while ((complexMeasureMatch = complexMeasureRegex.exec(tempExpr)) !== null) {
                const multiplier = parseInt(complexMeasureMatch[1], 10);
                if (!isNaN(multiplier)) {
                    measureTerms.push(multiplier);
                    console.log("Found complex measure term with multiplier:", multiplier);
                }
            }
            
            // Now match simple measure length terms that aren't part of a multiplier expression
            const simpleMeasureRegex = /module\.findMeasureLength\(module\.baseNote\)/g;
            let simpleMeasureMatch;
            tempExpr = expr;
            while ((simpleMeasureMatch = simpleMeasureRegex.exec(tempExpr)) !== null) {
                // Check if this is NOT part of a term with a multiplier
                const beforeMatch = tempExpr.substring(0, simpleMeasureMatch.index);
                const lastMulIndex = beforeMatch.lastIndexOf(".mul(");
                
                // If there's no .mul( or it's not close enough to be part of this term
                if (lastMulIndex === -1 || simpleMeasureMatch.index - lastMulIndex > 50) {
                    measureTerms.push(1); // Simple measure length without multiplier
                    console.log("Found simple measure term");
                }
            }
            
            // Extract tempo terms
            const tempoTerms = [];
            const simpleTempoRegex = /new\s+Fraction\(60\)\.div\(module\.findTempo\(module\.baseNote\)\)(?!\.mul)/g;
            let simpleTempoMatch;
            while ((simpleTempoMatch = simpleTempoRegex.exec(expr)) !== null) {
                tempoTerms.push(1); // Simple tempo term without multiplier
                console.log("Found simple tempo term");
            }
            
            // Modified regex to match both decimal multipliers and Fraction multipliers
            const complexTempoRegex = /new\s+Fraction\(60\)\.div\(module\.findTempo\(module\.baseNote\)\)\.mul\((?:new\s+Fraction\((\d+),\s*(\d+)\)|([^)]+))\)/g;
            let complexTempoMatch;
            while ((complexTempoMatch = complexTempoRegex.exec(expr)) !== null) {
                // Check if we matched a Fraction or a decimal
                if (complexTempoMatch[1] !== undefined && complexTempoMatch[2] !== undefined) {
                    // This is a Fraction(n,d) format
                    const numerator = parseInt(complexTempoMatch[1], 10);
                    const denominator = parseInt(complexTempoMatch[2], 10);
                    if (!isNaN(numerator) && !isNaN(denominator) && denominator !== 0) {
                        const multiplier = numerator / denominator;
                        tempoTerms.push(multiplier);
                        console.log("Found complex tempo term with fraction multiplier:", multiplier);
                    }
                } else if (complexTempoMatch[3] !== undefined) {
                    // This is a decimal multiplier
                    const multiplier = parseFloat(complexTempoMatch[3]);
                    if (!isNaN(multiplier)) {
                        tempoTerms.push(multiplier);
                        console.log("Found complex tempo term with multiplier:", multiplier);
                    }
                }
            }
            
            console.log("Measure terms:", measureTerms);
            console.log("Tempo terms:", tempoTerms);
            
            // Only proceed if we found terms to simplify
            if (measureTerms.length > 0 || tempoTerms.length > 0) {
                // Build the new expression
                let newExpr = "module.baseNote.getVariable('startTime')";
                
                // Add measure length term if needed
                if (measureTerms.length > 0) {
                    const totalMeasures = measureTerms.reduce((sum, val) => sum + val, 0);
                    if (totalMeasures === 1) {
                        newExpr += ".add(module.findMeasureLength(module.baseNote))";
                    } else {
                        newExpr += `.add(new Fraction(${totalMeasures}).mul(module.findMeasureLength(module.baseNote)))`;
                    }
                }
                
                // Add tempo term if needed
                if (tempoTerms.length > 0) {
                    const totalMultiplier = tempoTerms.reduce((sum, val) => sum + val, 0);
                    if (totalMultiplier === 1) {
                        newExpr += `.add(new Fraction(60).div(module.findTempo(module.baseNote)))`;
                    } else {
                        // Convert to fraction for more precise representation
                        const fracObj = new Fraction(totalMultiplier);
                        newExpr += `.add(new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(${fracObj.n}, ${fracObj.d})))`;
                    }
                }
                
                console.log("New expression:", newExpr);
                
                // Test the new expression to make sure it evaluates to the same value
                try {
                    const originalFunc = new Function("module", "Fraction", "return " + expr + ";");
                    const newFunc = new Function("module", "Fraction", "return " + newExpr + ";");
                    
                    const originalValue = originalFunc(window.myModule, Fraction).valueOf();
                    const newValue = newFunc(window.myModule, Fraction).valueOf();
                    
                    console.log("Original value:", originalValue);
                    console.log("New value:", newValue);
                    
                    // If the values are the same (within a small tolerance), return the simplified expression
                    if (Math.abs(originalValue - newValue) < 0.0001) {
                        console.log("Simplification successful!");
                        return newExpr;
                    } else {
                        console.warn(`Simplification would change value from ${originalValue} to ${newValue}, keeping original`);
                        return expr;
                    }
                } catch (evalError) {
                    console.error("Error evaluating expressions:", evalError);
                    return expr;
                }
            }
        } catch (error) {
            console.error("Error simplifying startTime expression:", error);
        }
        
        return expr;
    }
    
    // Find greatest common divisor (GCD)
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

    // Function to evaluate the entire module
    function evaluateEntireModule() {
        // Get all notes except the base note
        const noteIds = Object.keys(window.myModule.notes)
            .map(id => parseInt(id, 10))
            .filter(id => id !== 0);
        
        // Sort notes by ID to ensure dependencies are processed in order
        noteIds.sort((a, b) => a - b);
        
        let successCount = 0;
        let skippedCount = 0;
        
        // First pass: process all notes and collect those that fail
        const failedNotes = [];
        
        // Process each note
        for (const noteId of noteIds) {
            try {
                const note = window.myModule.getNoteById(noteId);
                if (!note) continue;
                
                // Check if this is a measure note (has startTime but no duration/frequency)
                const isMeasureNote = note.variables.startTime && 
                                     !note.variables.duration && 
                                     !note.variables.frequency;
                
                // Process each variable that might have dependencies
                const variablesToProcess = ['startTime', 'duration', 'frequency'];
                let noteSuccess = true;
                
                for (const varName of variablesToProcess) {
                    if (!note.variables[varName + 'String']) continue;
                    
                    // Get the original expression and value
                    const originalExpr = note.variables[varName + 'String'];
                    const originalValue = note.getVariable(varName).valueOf();
                    
                    // Skip if the expression already references only the base note
                    if (originalExpr.indexOf("module.getNoteById(") === -1 && 
                        (originalExpr.indexOf("module.baseNote") !== -1 || 
                         originalExpr.indexOf("new Fraction") !== -1)) {
                        continue;
                    }
                    
                    // Try to simplify the expression
                    let newExpr;
                    
                    try {
                        // Use our replaceNoteReferencesWithBaseNoteOnly function
                        newExpr = replaceNoteReferencesWithBaseNoteOnly(originalExpr, window.myModule);
                        
                        // Test the new expression
                        const testFunc = new Function("module", "Fraction", "return " + newExpr + ";");
                        const testResult = testFunc(window.myModule, Fraction);
                        
                        // If the values are close enough, use the new expression
                        if (Math.abs(testResult.valueOf() - originalValue) < 0.0001) {
                            note.setVariable(varName, function() {
                                return new Function("module", "Fraction", "return " + newExpr + ";")(window.myModule, Fraction);
                            });
                            note.setVariable(varName + 'String', newExpr);
                            noteSuccess = true;
                        } else {
                            // If values don't match, try a direct approach
                            const directExpr = createDirectExpression(varName, originalValue, window.myModule);
                            
                            // Test the direct expression
                            const directFunc = new Function("module", "Fraction", "return " + directExpr + ";");
                            const directResult = directFunc(window.myModule, Fraction);
                            
                            if (Math.abs(directResult.valueOf() - originalValue) < 0.0001) {
                                note.setVariable(varName, function() {
                                    return new Function("module", "Fraction", "return " + directExpr + ";")(window.myModule, Fraction);
                                });
                                note.setVariable(varName + 'String', directExpr);
                                noteSuccess = true;
                            } else {
                                noteSuccess = false;
                                failedNotes.push({
                                    noteId,
                                    varName,
                                    originalExpr,
                                    originalValue
                                });
                            }
                        }
                    } catch (error) {
                        console.error(`Error evaluating ${varName} for note ${noteId}:`, error);
                        noteSuccess = false;
                        failedNotes.push({
                            noteId,
                            varName,
                            originalExpr,
                            originalValue,
                            error: error.message
                        });
                    }
                }
                
                if (noteSuccess) {
                    successCount++;
                    window.myModule.markNoteDirty(noteId);
                } else {
                    skippedCount++;
                }
                
            } catch (error) {
                console.error(`Error evaluating note ${noteId}:`, error);
                skippedCount++;
                failedNotes.push({
                    noteId,
                    error: error.message
                });
            }
        }
        
        // Second pass: try to fix failed notes using a direct approach
        for (const failedNote of failedNotes) {
            try {
                const note = window.myModule.getNoteById(failedNote.noteId);
                if (!note) continue;
                
                const varName = failedNote.varName;
                const originalValue = failedNote.originalValue;
                
                // Create a direct expression using the evaluated value
                const directExpr = createDirectExpression(varName, originalValue, window.myModule);
                
                // Test the direct expression
                const directFunc = new Function("module", "Fraction", "return " + directExpr + ";");
                const directResult = directFunc(window.myModule, Fraction);
                
                if (Math.abs(directResult.valueOf() - originalValue) < 0.0001) {
                    note.setVariable(varName, function() {
                        return new Function("module", "Fraction", "return " + directExpr + ";")(window.myModule, Fraction);
                    });
                    note.setVariable(varName + 'String', directExpr);
                    successCount++;
                    skippedCount--;
                    window.myModule.markNoteDirty(failedNote.noteId);
                }
            } catch (error) {
                console.error(`Error in second pass for note ${failedNote.noteId}:`, error);
            }
        }
        
        // Helper function to create a direct expression based on the variable type and value
        function createDirectExpression(varName, value, moduleInstance) {
            const baseNote = moduleInstance.baseNote;
            
            if (varName === 'startTime') {
                const baseStartTime = baseNote.getVariable('startTime').valueOf();
                const offset = value - baseStartTime;
                
                // Convert to beats
                const baseTempo = baseNote.getVariable('tempo').valueOf();
                const beatLength = 60 / baseTempo;
                const offsetBeats = offset / beatLength;
                
                return `module.baseNote.getVariable('startTime').add(new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(${offsetBeats})))`;
            } else if (varName === 'duration') {
                const baseTempo = baseNote.getVariable('tempo').valueOf();
                const beatLength = 60 / baseTempo;
                const durationBeats = value / beatLength;
                
                return `new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(${durationBeats}))`;
            } else if (varName === 'frequency') {
                const baseFreq = baseNote.getVariable('frequency').valueOf();
                const ratio = value / baseFreq;
                
                return `new Fraction(${ratio}).mul(module.baseNote.getVariable('frequency'))`;
            }
            
            throw new Error(`Unsupported variable type: ${varName}`);
        }
        
        // Recompile all notes to ensure changes propagate
        for (const noteId of noteIds) {
            recompileNoteAndDependents(noteId);
        }
        
        // Reevaluate and update the visual representation
        window.evaluatedNotes = window.myModule.evaluateModule();
        externalFunctions.updateVisualNotes(window.evaluatedNotes);
        
        // Show success notification
        showNotification(`Module evaluation complete: ${successCount} notes processed, ${skippedCount} notes skipped`, 'success');
    }
    
    // Helper function to show notifications
    function showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.textContent = message;
        notification.style.position = 'fixed';
        notification.style.bottom = '20px';
        notification.style.right = '20px';
        notification.style.padding = '10px 20px';
        notification.style.borderRadius = '4px';
        notification.style.zIndex = '9999';
        notification.style.fontFamily = "'Roboto Mono', monospace";
        notification.style.fontSize = '14px';
        notification.style.transition = 'opacity 0.3s ease-in-out';
        
        if (type === 'success') {
            notification.style.backgroundColor = 'rgba(0, 255, 255, 0.8)';
            notification.style.color = '#151525';
        } else if (type === 'error') {
            notification.style.backgroundColor = 'rgba(255, 0, 0, 0.8)';
            notification.style.color = '#fff';
        } else {
            notification.style.backgroundColor = 'rgba(255, 168, 0, 0.8)';
            notification.style.color = '#000';
        }
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => {
                if (notification.parentNode) {
                    document.body.removeChild(notification);
                }
            }, 300);
        }, 3000);
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
        // Use the exposed function from player.js
        if (externalFunctions.clearLastSelectedNote) {
          externalFunctions.clearLastSelectedNote();
        }

        domCache.noteWidget.classList.remove('visible');
        currentSelectedNote = null; // Ensure currentSelectedNote is reset
        
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
        
        // Restore all notes in the stack to their original positions
        if (externalFunctions.originalNoteOrder) {
          externalFunctions.originalNoteOrder.forEach((noteData, noteId) => {
            const note = window.myModule.getNoteById(parseInt(noteId, 10));
            if (note && externalFunctions.restoreNotePosition) {
              externalFunctions.restoreNotePosition(note);
            }
          });
          externalFunctions.originalNoteOrder.clear();
        } else {
          console.warn("originalNoteOrder not found in externalFunctions");
        }
    }

    // Update note widget height based on content
    function updateNoteWidgetHeight() {
        const widget = domCache.noteWidget;
        if (!widget) return;
    
        // Get the header and content elements
        const header = widget.querySelector('.note-widget-header');
        const content = widget.querySelector('.note-widget-content');
        if (!header || !content) return;
        
        // Get the header height
        const headerHeight = header.offsetHeight;
        
        // Get the widget's current position
        const rect = widget.getBoundingClientRect();
        
        // Calculate available space - this is the key part that needs fixing
        const availableSpace = window.innerHeight - rect.top - MIN_BUFFER;
    
        // Calculate the content's natural height
        const contentNaturalHeight = content.scrollHeight;
        
        // Use a fixed padding value (no calculations)
        const PADDING = 5;
        
        // Calculate the desired widget height
        const widgetDesiredHeight = headerHeight + contentNaturalHeight + PADDING;
        
        // Determine minimum height based on initial state
        const minInitialHeight = widgetInitiallyOpened ? 40 : 300;
        
        // Calculate effective height - IMPORTANT: Always use the maximum available space
        // This is the key fix - we're ensuring the widget can expand to use available space
        const effectiveHeight = Math.max(minInitialHeight, Math.min(availableSpace, widgetDesiredHeight));
        
        // Apply the height to the widget
        widget.style.height = effectiveHeight + "px";
        
        // Calculate content height directly from widget height
        const contentHeight = effectiveHeight - headerHeight - PADDING;
        
        // Apply the height to the content
        content.style.height = Math.max(40, contentHeight) + "px";
        content.style.overflowY = "auto";
    }

    // Handle window resize for widget positioning
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
    
        // Update the widget height on window resize
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
            // Pause playback if it's active
            if (window.playerState && window.playerState.isPlaying && !window.playerState.isPaused && window.playerControls && window.playerControls.pause) {
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
            // Pause playback if it's active
            if (window.playerState && window.playerState.isPlaying && !window.playerState.isPaused && window.playerControls && window.playerControls.pause) {
                window.playerControls.pause();
            }
            // Call deleteNoteKeepDependencies instead of deleteNoteAndDependencies
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
            // Pause playback if it's active
            if (window.playerState && window.playerState.isPlaying && !window.playerState.isPaused && window.playerControls && window.playerControls.pause) {
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
        
        // First, check if the expression has balanced parentheses
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
            // For duration expressions with the specific pattern we're generating
            if (variableType === 'duration' && 
                expression.startsWith('new Fraction(60).div(') && 
                expression.includes(').mul(new Fraction(')) {
                
                // This is our standard duration format, validate it directly
                const testFunc = new Function('module', 'Fraction', `
                    return ${expression};
                `);
                const result = testFunc(moduleInstance, Fraction);
                
                if (!(result instanceof Fraction)) {
                    throw new Error('Duration expression must result in a Fraction');
                }
                
                return expression;
            }
            
            // For other expressions
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
        setExternalFunctions,
        showEvaluateConfirmation,
        showEvaluateModuleConfirmation,
        evaluateNoteToBaseNote,
        evaluateEntireModule
    };

    // Initialize when DOM is loaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();