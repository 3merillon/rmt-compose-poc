(function() {
    const domCache = {
        noteWidget: document.getElementById('note-widget'),
        closeWidgetBtn: document.querySelector('.note-widget-close'),
        widgetContent: document.querySelector('.note-widget-content'),
        widgetTitle: document.getElementById('note-widget-title')
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
        cleanSlate: null
    };

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

    function clearAllHighlights() {
        const highlightedElements = document.querySelectorAll('.dependency, .dependent');
        batchClassOperation(highlightedElements, [], ['dependency', 'dependent']);
    }

    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            const context = this;
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(context, args), wait);
        };
    }

    function extractTempoPart(expr) {
        if (!expr.startsWith("new Fraction(60).div(")) {
            return "new Fraction(60).div(module.findTempo(module.baseNote))";
        }
        
        let start = "new Fraction(60).div(".length;
        let openParens = 1;
        let end = start;
        
        while (end < expr.length && openParens > 0) {
            if (expr[end] === '(') openParens++;
            else if (expr[end] === ')') openParens--;
            end++;
        }
        
        if (openParens === 0) {
            return expr.substring(0, end);
        }
        
        return "new Fraction(60).div(module.findTempo(module.baseNote))";
    }

    function liberateDependencies(noteId) {
        const selectedNote = myModule.getNoteById(noteId);
        if (!selectedNote) return;
        
        const currentSelectedNote = selectedNote;
        
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
                if (!fracStr.includes("/")) {
                    fracStr = fracStr + "/1";
                }
                selectedRaw[varName] = "new Fraction(" + fracStr + ")";
            }
        });
        
        externalFunctions.updateDependentRawExpressions(noteId, selectedRaw);
        
        const dependents = myModule.getDependentNotes(noteId);
        dependents.forEach(depId => {
            myModule.markNoteDirty(depId);
        });
        
        evaluatedNotes = myModule.evaluateModule();
        externalFunctions.updateVisualNotes(evaluatedNotes);
        
        const newElem = document.querySelector(`.note-content[data-note-id="${noteId}"]`);
        
        if (currentSelectedNote && currentSelectedNote.id !== 0 && newElem) {
            if (externalFunctions.bringSelectedNoteToFront) {
                externalFunctions.bringSelectedNoteToFront(currentSelectedNote, newElem);
            }
        }
        
        showNoteVariables(currentSelectedNote, newElem);
        
        showNotification('Dependencies liberated successfully!', 'success');
    }

    function findParentWithFrequency(note) {
        if (!note) return null;
        let parentId = null;
        const startTimeString = note.variables.startTimeString;
        if (startTimeString) {
            const match = /getNoteById\((\d+)\)/.exec(startTimeString);
            if (match) parentId = parseInt(match[1], 10);
        }
        if (parentId === null && note.parentId !== undefined) parentId = note.parentId;
        if (parentId === null) parentId = 0;
        if (parentId === note.id) return null;
        const parent = window.myModule.getNoteById(parentId);
        if (!parent) return null;
        if (typeof parent.getVariable === 'function' && parent.getVariable('frequency')) return parent;
        return findParentWithFrequency(parent);
    }

    function replaceFrequencyParentInFormula(formula, newParentId) {
        return formula.replace(
            /\.mul\s*\(\s*module\.getNoteById\(\s*\d+\s*\)\.getVariable\('frequency'\)\s*\)/,
            `.mul(module.getNoteById(${newParentId}).getVariable('frequency'))`
        );
    }

    function showNoteVariables(note, clickedElement, measureId = null) {
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
            const selfNoteId = effectiveNoteId;
            
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
        
        Object.entries(variables).forEach(([key, value]) => {
        const variableRow = document.createElement('div');
        variableRow.className = 'variable-row';
        
        const variableNameDiv = document.createElement('div');
        variableNameDiv.className = 'variable-name';
        variableNameDiv.textContent = key;
        
        const variableValueDiv = document.createElement('div');
        variableValueDiv.className = 'variable-value';
        
        let evaluatedDiv = document.createElement('div');
        evaluatedDiv.className = 'evaluated-value';
        
        if (key === 'instrument') {
            const instrumentContainer = document.createElement('div');
            instrumentContainer.style.display = 'flex';
            instrumentContainer.style.flexDirection = 'column';
            instrumentContainer.style.gap = '8px';
            
            const evaluatedText = document.createElement('div');
            if (value.isInherited) {
                evaluatedText.innerHTML = `<span class="value-label">Inherited:</span> <span style="color: #aaa;">${value.evaluated}</span>`;
            } else {
                evaluatedText.innerHTML = `<span class="value-label">Current:</span> ${value.evaluated}`;
            }
            instrumentContainer.appendChild(evaluatedText);
            
            const instrumentSelect = document.createElement('select');
            instrumentSelect.className = 'instrument-select';
            instrumentSelect.style.padding = '4px';
            instrumentSelect.style.backgroundColor = '#333';
            instrumentSelect.style.color = '#ffa800';
            instrumentSelect.style.border = '1px solid #ffa800';
            instrumentSelect.style.borderRadius = '4px';
            instrumentSelect.style.width = '100%';
            instrumentSelect.style.marginTop = '5px';
            
            let synthInstruments = [];
            let sampleInstruments = [];

            if (window.instrumentManager) {
                try {
                    const allInstruments = window.instrumentManager.getAvailableInstruments();
                    
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
                    
                    sampleInstruments.sort();
                } catch (err) {
                    console.warn('Failed to get available instruments from instrumentManager:', err);
                    synthInstruments = ['sine-wave', 'square-wave', 'sawtooth-wave', 'triangle-wave', 'organ', 'vibraphone'];
                    sampleInstruments = [];
                }
            } else {
                synthInstruments = ['sine-wave', 'square-wave', 'sawtooth-wave', 'triangle-wave', 'organ', 'vibraphone'];
                sampleInstruments = [];
            }

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

            if (instrumentSelect.children.length === 0) {
                const option = document.createElement('option');
                option.value = 'sine-wave';
                option.textContent = 'sine-wave';
                if (value.evaluated === 'sine-wave') {
                    option.selected = true;
                }
                instrumentSelect.appendChild(option);
            }
            
            const saveButton = document.createElement('button');
            saveButton.className = 'raw-value-save';
            saveButton.textContent = 'Save';
            saveButton.style.display = 'none';
            saveButton.style.marginTop = '5px';
            
            instrumentSelect.addEventListener('input', () => {
                saveButton.style.display = 'block';
            });
            
            saveButton.addEventListener('click', () => {
                try {
                    if (window.playerState && window.playerState.isPlaying && !window.playerState.isPaused && window.playerControls && window.playerControls.pause) {
                        window.playerControls.pause();
                    }
                    
                    const currentlySelectedNote = note;
                    
                    const newValue = instrumentSelect.value;
                    note.setVariable('instrument', newValue);
                    
                    window.evaluatedNotes = window.myModule.evaluateModule();
                    externalFunctions.updateVisualNotes(window.evaluatedNotes);
                    
                    const newElem = document.querySelector(`.note-content[data-note-id="${note.id}"]`);
                    
                    if (currentlySelectedNote && currentlySelectedNote.id !== 0 && newElem) {
                        if (externalFunctions.bringSelectedNoteToFront) {
                            externalFunctions.bringSelectedNoteToFront(currentlySelectedNote, newElem);
                        }
                    }
                    
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
            
            if (!value.isInherited && note.id !== 0) {
                const resetButton = document.createElement('button');
                resetButton.className = 'raw-value-save';
                resetButton.textContent = 'Use Inherited';
                resetButton.style.backgroundColor = '#555';
                resetButton.style.marginTop = '5px';
                
                resetButton.addEventListener('click', () => {
                    try {
                        if (window.playerState && window.playerState.isPlaying && !window.playerState.isPaused && window.playerControls && window.playerControls.pause) {
                            window.playerControls.pause();
                        }
                        
                        const currentlySelectedNote = note;
                        
                        delete note.variables.instrument;
                        
                        window.myModule.markNoteDirty(note.id);
                        
                        window.evaluatedNotes = window.myModule.evaluateModule();
                        externalFunctions.updateVisualNotes(window.evaluatedNotes);
                        
                        const newElem = document.querySelector(`.note-content[data-note-id="${note.id}"]`);
                        
                        if (currentlySelectedNote && currentlySelectedNote.id !== 0 && newElem) {
                            if (externalFunctions.bringSelectedNoteToFront) {
                                externalFunctions.bringSelectedNoteToFront(currentlySelectedNote, newElem);
                            }
                        }
                        
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
            
            instrumentContainer.appendChild(instrumentSelect);
            instrumentContainer.appendChild(saveButton);
            
            evaluatedDiv.appendChild(instrumentContainer);
            
            variableValueDiv.appendChild(evaluatedDiv);
            
        } else if (key === 'frequency') {
            const evaluatedContainer = document.createElement('div');
            evaluatedContainer.style.display = 'flex';
            evaluatedContainer.style.justifyContent = 'space-between';
            evaluatedContainer.style.alignItems = 'center';
            
            const evaluatedText = document.createElement('div');
            evaluatedText.innerHTML = `<span class="value-label">Evaluated:</span> ${value.evaluated !== null ? String(value.evaluated) : 'null'}`;
            evaluatedContainer.appendChild(evaluatedText);
            
            const octaveButtonsContainer = document.createElement('div');
            octaveButtonsContainer.style.display = 'flex';
            octaveButtonsContainer.style.flexDirection = 'column';
            octaveButtonsContainer.style.marginLeft = '10px';
            
            const upOctaveButton = document.createElement('button');
            upOctaveButton.className = 'octave-button octave-up-widget';
            upOctaveButton.textContent = '▲';
            upOctaveButton.style.width = '26px';
            upOctaveButton.style.height = '26px';
            upOctaveButton.style.padding = '0';
            upOctaveButton.style.backgroundColor = '#444';
            upOctaveButton.style.border = '1px solid orange';
            upOctaveButton.style.borderRadius = '4px';
            upOctaveButton.style.cursor = 'pointer';
            upOctaveButton.style.display = 'flex';
            upOctaveButton.style.alignItems = 'center';
            upOctaveButton.style.justifyContent = 'center';
            upOctaveButton.style.fontSize = '14px';
            upOctaveButton.style.color = '#fff';
            upOctaveButton.style.marginBottom = '4px';

            const downOctaveButton = document.createElement('button');
            downOctaveButton.className = 'octave-button octave-down-widget';
            downOctaveButton.textContent = '▼';
            downOctaveButton.style.width = '26px';
            downOctaveButton.style.height = '26px';
            downOctaveButton.style.padding = '0';
            downOctaveButton.style.backgroundColor = '#444';
            downOctaveButton.style.border = '1px solid orange';
            downOctaveButton.style.borderRadius = '4px';
            downOctaveButton.style.cursor = 'pointer';
            downOctaveButton.style.display = 'flex';
            downOctaveButton.style.alignItems = 'center';
            downOctaveButton.style.justifyContent = 'center';
            downOctaveButton.style.fontSize = '14px';
            downOctaveButton.style.color = '#fff';
            
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
            
            upOctaveButton.addEventListener('click', (event) => {
                event.stopPropagation();
                event.preventDefault();
                window.handleOctaveChange(note.id, 'up');
            });
            
            downOctaveButton.addEventListener('click', (event) => {
                event.stopPropagation();
                event.preventDefault();
                window.handleOctaveChange(note.id, 'down');
            });
            
            octaveButtonsContainer.appendChild(upOctaveButton);
            octaveButtonsContainer.appendChild(downOctaveButton);
            
            evaluatedContainer.appendChild(octaveButtonsContainer);
            
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
                    if (window.playerState && window.playerState.isPlaying && !window.playerState.isPaused && window.playerControls && window.playerControls.pause) {
                        window.playerControls.pause();
                    }
                    
                    const currentlySelectedNote = note;
                    
                    const isMeasureBar = measureId !== null;
                    let currentZIndex = null;
                    
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
                            window.myModule.markNoteDirty(note.id);
                        }
                    } else {
                        const currentNoteId = measureId !== null ? measureId : note.id;
                        const validatedExpression = validateExpression(window.myModule, currentNoteId, newRawValue, key);
                        
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
                                
                                if (key === 'duration') {
                                    const updatedDuration = note.getVariable('duration').valueOf();
                                    if (Math.abs(originalDuration - updatedDuration) > 0.001) {
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
                            
                            if (key === 'duration') {
                                const updatedDuration = note.getVariable('duration').valueOf();
                                if (Math.abs(originalDuration - updatedDuration) > 0.001) {
                                    externalFunctions.checkAndUpdateDependentNotes(note.id, originalDuration, updatedDuration);
                                }
                            }
                        }
                    }
                    
                    recompileNoteAndDependents(note.id);

                    if (note === window.myModule.baseNote) {
                        externalFunctions.updateBaseNoteFraction();
                        externalFunctions.updateBaseNotePosition();
                    }
                    
                    window.evaluatedNotes = window.myModule.evaluateModule();
                    externalFunctions.updateVisualNotes(window.evaluatedNotes);
                    
                    let newElem;
                    
                    if (isMeasureBar) {
                        newElem = document.querySelector(`.measure-bar-triangle[data-note-id="${measureId}"]`);
                        
                        if (newElem && currentZIndex) {
                            newElem.style.zIndex = currentZIndex;
                        }
                    } else {
                        newElem = document.querySelector(`.note-content[data-note-id="${note.id}"]`);
                        
                        if (currentlySelectedNote && currentlySelectedNote.id !== 0 && newElem) {
                            if (externalFunctions.bringSelectedNoteToFront) {
                                externalFunctions.bringSelectedNoteToFront(currentlySelectedNote, newElem);
                            }
                        }
                    }
                    
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
            evaluatedDiv.innerHTML = `<span class="value-label">Evaluated:</span> ${value.evaluated !== null ? String(value.evaluated) : 'null'}`;
            
            variableValueDiv.appendChild(evaluatedDiv);
            
            if (key === 'duration') {
                const durationPicks = document.createElement('div');
                durationPicks.className = 'duration-picks';
                durationPicks.style.display = 'flex';
                durationPicks.style.justifyContent = 'space-between';
                durationPicks.style.alignItems = 'center';
                
                const leftContainer = document.createElement('div');
                leftContainer.style.display = 'flex';
                leftContainer.style.gap = '4px';
                
                const rightContainer = document.createElement('div');
                rightContainer.style.display = 'flex';
                rightContainer.style.gap = '4px';
                
                const basePicks = [
                    { base: 4, symbol: '𝅝' },
                    { base: 2, symbol: '𝅗𝅥' },
                    { base: 1, symbol: '𝅘𝅥' },
                    { base: 0.5, symbol: '𝅘𝅥𝅮' },
                    { base: 0.25, symbol: '𝅘𝅥𝅯' }
                ];
                
                const dotPicks = [
                    { mod: 'dot', factor: 1.5, label: '.' },
                    { mod: 'double', factor: 1.75, label: '..' }
                ];
                
                let selectedBase = null;
                let selectedMod = 1;
                let currentMultiplier = null;
                
                let decimalRegex = /^new Fraction\(60\)\.div\((.*?)\)\.mul\(([\d\.]+)\)$/;
                let decimalMatch = value.raw.match(decimalRegex);
                
                if (decimalMatch && decimalMatch[2]) {
                    currentMultiplier = parseFloat(decimalMatch[2]);
                } else {
                    let fractionRegex = /^new Fraction\(60\)\.div\((.*?)\)\.mul\(new Fraction\((\d+),\s*(\d+)\)\)$/;
                    let fractionMatch = value.raw.match(fractionRegex);
                    
                    if (fractionMatch && fractionMatch[2] && fractionMatch[3]) {
                        const numerator = parseInt(fractionMatch[2], 10);
                        const denominator = parseInt(fractionMatch[3], 10);
                        if (!isNaN(numerator) && !isNaN(denominator) && denominator !== 0) {
                            currentMultiplier = numerator / denominator;
                        }
                    } else {
                        currentMultiplier = 1;
                    }
                }
                
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
                    btn.style.transition = "background-color 0.3s ease";
                    
                    if (selectedBase !== null && Math.abs(bp.base - selectedBase) < 0.001) {
                        btn.style.backgroundColor = "#ff0000";
                    }
                    
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
                        
                        const baseForCalc = selectedBase;
                        const modForCalc = selectedMod;
                        const multiplier = baseForCalc * modForCalc;
                        
                        let fraction;
                        try {
                            fraction = new Fraction(multiplier);
                        } catch (err) {
                            console.error("Error creating fraction:", err);
                            if (multiplier === 0.25) fraction = new Fraction(1, 4);
                            else if (multiplier === 0.5) fraction = new Fraction(1, 2);
                            else if (multiplier === 0.75) fraction = new Fraction(3, 4);
                            else if (multiplier === 1) fraction = new Fraction(1, 1);
                            else if (multiplier === 1.5) fraction = new Fraction(3, 2);
                            else if (multiplier === 2) fraction = new Fraction(2, 1);
                            else if (multiplier === 3) fraction = new Fraction(3, 1);
                            else if (multiplier === 4) fraction = new Fraction(4, 1);
                            else fraction = new Fraction(Math.round(multiplier * 4), 4);
                        }
                        
                        let tempoReference;
                        if (originalExpr.includes("module.getNoteById")) {
                            const noteIdMatch = originalExpr.match(/module\.getNoteById\((\d+)\)/);
                            if (noteIdMatch && noteIdMatch[1]) {
                                tempoReference = `module.findTempo(module.getNoteById(${noteIdMatch[1]}))`;
                            } else {
                                tempoReference = "module.findTempo(module.baseNote)";
                            }
                        } else {
                            tempoReference = "module.findTempo(module.baseNote)";
                        }
                        
                        newExpr = `new Fraction(60).div(${tempoReference}).mul(new Fraction(${fraction.n}, ${fraction.d}))`;
                        
                        const rawInput = variableValueDiv.querySelector('.raw-value-input');
                        const saveButton = variableValueDiv.querySelector('.raw-value-save');
                        rawInput.value = newExpr;
                        saveButton.style.display = 'inline-block';
                        
                        Array.from(leftContainer.children).forEach(child => {
                            child.style.backgroundColor = "#444";
                        });
                        btn.style.backgroundColor = "#ff0000";
                        
                        if (Math.abs(selectedMod - 1) < 0.001) {
                            Array.from(rightContainer.children).forEach(child => {
                                child.style.backgroundColor = "#444";
                            });
                        }
                    });
                    leftContainer.appendChild(btn);
                });
                
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
                    btn.style.transition = "background-color 0.3s ease";
                    
                    if (selectedMod !== null && Math.abs(selectedMod - dp.factor) < 0.001) {
                        btn.style.backgroundColor = "#ff0000";
                    }
                    
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
                        if (selectedMod !== null && Math.abs(selectedMod - dp.factor) < 0.001) {
                            selectedMod = 1;
                        } else {
                            selectedMod = dp.factor;
                        }
                        
                        let originalExpr = value.raw;
                        let newExpr;
                        
                        const baseForCalc = selectedBase !== null ? selectedBase : 1;
                        const modForCalc = selectedMod;
                        const multiplier = baseForCalc * modForCalc;
                        
                        let fraction;
                        try {
                            fraction = new Fraction(multiplier);
                        } catch (err) {
                            console.error("Error creating fraction:", err);
                            if (multiplier === 0.25) fraction = new Fraction(1, 4);
                            else if (multiplier === 0.5) fraction = new Fraction(1, 2);
                            else if (multiplier === 0.75) fraction = new Fraction(3, 4);
                            else if (multiplier === 1) fraction = new Fraction(1, 1);
                            else if (multiplier === 1.5) fraction = new Fraction(3, 2);
                            else if (multiplier === 2) fraction = new Fraction(2, 1);
                            else if (multiplier === 3) fraction = new Fraction(3, 1);
                            else if (multiplier === 4) fraction = new Fraction(4, 1);
                            else fraction = new Fraction(Math.round(multiplier * 4), 4);
                        }
                        
                        let tempoPart = extractTempoPart(originalExpr);
                
                        newExpr = `${tempoPart}.mul(new Fraction(${fraction.n}, ${fraction.d}))`;
                        
                        const rawInput = variableValueDiv.querySelector('.raw-value-input');
                        const saveButton = variableValueDiv.querySelector('.raw-value-save');
                        rawInput.value = newExpr;
                        saveButton.style.display = 'inline-block';
                        
                        Array.from(rightContainer.children).forEach(child => {
                            child.style.backgroundColor = "#444";
                        });
                        
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
                    if (window.playerState && window.playerState.isPlaying && !window.playerState.isPaused && window.playerControls && window.playerControls.pause) {
                        window.playerControls.pause();
                    }
                    
                    const currentlySelectedNote = note;
                    
                    const isMeasureBar = measureId !== null;
                    let currentZIndex = null;
                    
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
                            window.myModule.markNoteDirty(note.id);
                        }
                    } else {
                        const currentNoteId = measureId !== null ? measureId : note.id;
                        const validatedExpression = validateExpression(window.myModule, currentNoteId, newRawValue, key);
                        
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
                                
                                if (key === 'duration') {
                                    const updatedDuration = note.getVariable('duration').valueOf();
                                    if (Math.abs(originalDuration - updatedDuration) > 0.001) {
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
                            
                            if (key === 'duration') {
                                const updatedDuration = note.getVariable('duration').valueOf();
                                if (Math.abs(originalDuration - updatedDuration) > 0.001) {
                                    externalFunctions.checkAndUpdateDependentNotes(note.id, originalDuration, updatedDuration);
                                }
                            }
                        }
                    }
                    
                    recompileNoteAndDependents(note.id);

                    if (note === window.myModule.baseNote) {
                        externalFunctions.updateBaseNoteFraction();
                        externalFunctions.updateBaseNotePosition();
                    }
                    
                    window.evaluatedNotes = window.myModule.evaluateModule();
                    externalFunctions.updateVisualNotes(window.evaluatedNotes);
                    
                    let newElem;
                    
                    if (isMeasureBar) {
                        newElem = document.querySelector(`.measure-bar-triangle[data-note-id="${measureId}"]`);
                        
                        if (newElem && currentZIndex) {
                            newElem.style.zIndex = currentZIndex;
                        }
                    } else {
                        newElem = document.querySelector(`.note-content[data-note-id="${note.id}"]`);
                        
                        if (currentlySelectedNote && currentlySelectedNote.id !== 0 && newElem) {
                            if (externalFunctions.bringSelectedNoteToFront) {
                                externalFunctions.bringSelectedNoteToFront(currentlySelectedNote, newElem);
                            }
                        }
                    }
                    
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
            shouldShowAdd = true;
        } else if (measureId !== null) {
            shouldShowAdd = externalFunctions.isLastMeasureInChain(measureId);
        }
        
        if (shouldShowAdd) {
            const addMeasureSection = document.createElement('div');
            addMeasureSection.className = 'variable-row';
            
            const addNameDiv = document.createElement('div');
            addNameDiv.className = 'variable-name';
            
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
                } else {
                    fromNote = (note === window.myModule.baseNote) ? window.myModule.baseNote : window.myModule.getNoteById(measureId);
                    newMeasures = window.myModule.generateMeasures(fromNote, 1);
                }
                
                newMeasures.forEach(measure => {
                    measure.getVariable('startTime');
                });
                
                const newMeasure = newMeasures[0];
                
                if (newMeasure) {
                    const newMeasureStart = newMeasure.getVariable('startTime').valueOf();
                    const measureLength = window.myModule.findMeasureLength(newMeasure).valueOf();
                    const newMeasureEnd = newMeasureStart + measureLength;
                    
                    const directDependents = [];
                    
                    const isDirectlyDependentOnMeasure = (noteId, measureId) => {
                        const note = window.myModule.getNoteById(noteId);
                        if (!note || !note.variables || !note.variables.startTimeString) {
                            return false;
                        }
                        
                        const startTimeString = note.variables.startTimeString;
                        const regex = new RegExp(`module\\.getNoteById\\(\\s*${measureId}\\s*\\)\\.getVariable\\('startTime'\\)`);
                        return regex.test(startTimeString);
                    };
                    
                    Object.keys(window.myModule.notes).forEach(id => {
                        const noteId = parseInt(id, 10);
                        if (noteId !== newMeasure.id && isDirectlyDependentOnMeasure(noteId, fromNote.id)) {
                            directDependents.push(noteId);
                        }
                    });
                    
                    directDependents.forEach(depId => {
                        const depNote = window.myModule.getNoteById(depId);
                        
                        if (!depNote || !depNote.getVariable) {
                            return;
                        }
                        
                        const noteStartTime = depNote.getVariable('startTime').valueOf();
                        
                        if (noteStartTime >= newMeasureStart && noteStartTime < newMeasureEnd) {
                            const baseTempo = window.myModule.baseNote.getVariable('tempo').valueOf();
                            const beatLength = 60 / baseTempo;
                            const beatOffset = (noteStartTime - newMeasureStart) / beatLength;
                            
                            let beatOffsetFraction;
                            if (Number.isInteger(beatOffset)) {
                                beatOffsetFraction = `new Fraction(${beatOffset}, 1)`;
                            } else {
                                const fraction = new Fraction(beatOffset);
                                beatOffsetFraction = `new Fraction(${fraction.n}, ${fraction.d})`;
                            }
                            
                            const newRaw = `module.getNoteById(${newMeasure.id}).getVariable('startTime').add(new Fraction(60).div(module.findTempo(module.getNoteById(${newMeasure.id}))).mul(${beatOffsetFraction}))`;
                            
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
            let defaultDurFormula = note.variables.durationString || "new Fraction(1,1)";
            durInput.value = defaultDurFormula;

            durRawDiv.appendChild(durInput);

            durValueDiv.appendChild(durEvalDiv);
            durValueDiv.appendChild(durRawDiv);
            durRow.appendChild(durNameDiv);
            durRow.appendChild(durValueDiv);

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

            freqInput.dispatchEvent(new Event('input'));
            durInput.dispatchEvent(new Event('input'));
            stInput.dispatchEvent(new Event('input'));

            const createBtn = document.createElement('button');
            createBtn.textContent = 'Create Note';
            createBtn.className = 'module-action-btn';
            createBtn.style.marginTop = '10px';
            createBtn.style.background = '#00ffcc';
            createBtn.style.color = '#151525';

            createBtn.addEventListener('click', () => {
                try {
                    if (window.playerState && window.playerState.isPlaying && !window.playerState.isPaused && 
                        window.playerControls && window.playerControls.pause) {
                        window.playerControls.pause();
                    }
                    
                    const currentNote = window.myModule.getNoteById(noteId);
                    if (!currentNote) {
                        throw new Error("Cannot find note with ID " + noteId);
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

                    if (currentNote.variables && currentNote.variables.color) {
                        variables.color = typeof currentNote.variables.color === "function"
                            ? currentNote.variables.color()
                            : currentNote.variables.color;
                    } else {
                        const hue = Math.floor(Math.random() * 360);
                        variables.color = `hsla(${hue}, 70%, 60%, 0.7)`;
                    }

                    const newNote = window.myModule.addNote(variables);
                    console.log(`Created new note with ID ${newNote.id}`);

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
                    
                    if (typeof invalidateModuleEndTimeCache === 'function') {
                        invalidateModuleEndTimeCache();
                    }

                    const newElem = document.querySelector(`.note-content[data-note-id="${newNote.id}"]`);
                    if (newElem && window.modals && typeof window.modals.showNoteVariables === 'function') {
                        window.modals.showNoteVariables(newNote, newElem);
                    }

                } catch (err) {
                    console.error("Error creating note:", err);
                    alert("Error creating note: " + err.message);
                }
            });

            addSection.appendChild(createBtn);

            widgetContent.appendChild(addSection);
        }

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
            durInput.value = `new Fraction(60).div(module.baseNote.getVariable('tempo'))`;
            durRawDiv.appendChild(durInput);

            durValueDiv.appendChild(durEvalDiv);
            durValueDiv.appendChild(durRawDiv);
            durRow.appendChild(durNameDiv);
            durRow.appendChild(durValueDiv);

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

            addSection.appendChild(freqRow);
            addSection.appendChild(durRow);
            addSection.appendChild(stRow);

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

            freqInput.dispatchEvent(new Event('input'));
            durInput.dispatchEvent(new Event('input'));
            stInput.dispatchEvent(new Event('input'));

            const createBtn = document.createElement('button');
            createBtn.textContent = 'Create';
            createBtn.className = 'module-action-btn';
            createBtn.style.marginTop = '10px';
            createBtn.style.background = '#00ffcc';
            createBtn.style.color = '#151525';

            createBtn.addEventListener('click', () => {
                try {
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

                    const hue = Math.floor(Math.random() * 360);
                    variables.color = `hsla(${hue}, 70%, 60%, 0.7)`;

                    const newNote = window.myModule.addNote(variables);

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

                    const newElem = document.querySelector(`.note-content[data-note-id="${newNote.id}"]`);
                    if (newElem && window.modals && typeof window.modals.showNoteVariables === 'function') {
                        window.modals.showNoteVariables(newNote, newElem);
                    }

                } catch (err) {
                    alert("Error creating note: " + err.message);
                }
            });

            addSection.appendChild(createBtn);

            widgetContent.appendChild(addSection);
        }
        
        if (note !== window.myModule.baseNote) {
            const evaluateWrapper = document.createElement('div');
            evaluateWrapper.className = 'evaluate-note-row';
            
            const evaluateHeader = document.createElement('div');
            evaluateHeader.className = 'evaluate-note-header';
            evaluateHeader.textContent = 'EVALUATE';
            
            evaluateWrapper.appendChild(evaluateHeader);
            
            const isMeasureBar = note.variables.startTime && !note.variables.duration;
            
            if (!isMeasureBar) {
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
    
        if (!clickedElement && note && note.id !== undefined) {
            const selElem = document.querySelector(`[data-note-id="${note.id}"]`);
            if (selElem) {
                selElem.classList.add("selected");
            }
        }
        
        currentSelectedNote = note;
    }
    
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
    
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) {
                e.stopPropagation();
                document.body.removeChild(overlay);
            }
        });
    
        document.body.appendChild(overlay);
    }

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
            if (window.playerState && window.playerState.isPlaying && !window.playerState.isPaused && window.playerControls && window.playerControls.pause) {
                window.playerControls.pause();
            }
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

    function balanceParentheses(expr) {
        let openCount = 0;
        for (const char of expr) {
        if (char === '(') openCount++;
        else if (char === ')') openCount--;
        }
        if (openCount > 0) {
        expr += ')'.repeat(openCount);
        }
        if (openCount < 0) {
        while (openCount < 0 && expr.endsWith(')')) {
            expr = expr.slice(0, -1);
            openCount++;
        }
        }
        return expr;
    }
    
    function evaluateNoteToBaseNote(noteId) {
        const note = window.myModule.getNoteById(parseInt(noteId, 10));
        if (!note) {
            console.error("Note not found:", noteId);
            return;
        }
        
        const currentSelectedNote = note;
        
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
                newRawExpr = replaceNoteReferencesWithBaseNoteOnly(currentRawExpr, window.myModule);
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
                        const baseFreq = window.myModule.baseNote.getVariable('frequency').valueOf();
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
                const testResult = testFunc(window.myModule, Fraction);
                const originalValue = note.getVariable(varName).valueOf();
                const newValue = testResult.valueOf();
                
                if (Math.abs(originalValue - newValue) > 0.0001) {
                    return;
                }
                
                note.setVariable(varName, function() {
                    return new Function("module", "Fraction", "return " + newRawExpr + ";")(window.myModule, Fraction);
                });
                note.setVariable(varName + 'String', newRawExpr);
            } catch (error) {
                console.error(`Error evaluating ${varName} for note ${noteId}:`, error);
                success = false;
            }
        });
        
        recompileNoteAndDependents(note.id);
        window.myModule.markNoteDirty(note.id);
        window.evaluatedNotes = window.myModule.evaluateModule();
        externalFunctions.updateVisualNotes(window.evaluatedNotes);
        
        const newElem = document.querySelector(`.note-content[data-note-id="${noteId}"]`);
        
        if (currentSelectedNote && currentSelectedNote.id !== 0 && newElem) {
            if (externalFunctions.bringSelectedNoteToFront) {
                externalFunctions.bringSelectedNoteToFront(currentSelectedNote, newElem);
            }
        }
        
        showNoteVariables(currentSelectedNote, newElem);
        
        if (success) {
            showNotification('Note evaluated successfully!', 'success');
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
            
            currentExpr = currentExpr.replace(measureLengthRegex, () => {
                return 'module.findMeasureLength(module.baseNote)';
            });
            
            currentExpr = currentExpr.replace(tempoRegex, () => {
                return 'module.findTempo(module.baseNote)';
            });
            
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
            
            if (newExpr !== currentExpr) {
                currentExpr = newExpr;
            }
        }
        
        currentExpr = currentExpr.replace(/module\.getNoteById\(0\)/g, 'module.baseNote');
        
        return simplifyExpressions(currentExpr);
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
                fractions.push({
                    n: parseInt(match[1], 10),
                    d: parseInt(match[2], 10)
                });
            }
            
            if (fractions.length > 1) {
                let resultN = 1;
                let resultD = 1;
                
                fractions.forEach(frac => {
                    resultN *= frac.n;
                    resultD *= frac.d;
                });
                
                const gcd = findGCD(resultN, resultD);
                resultN /= gcd;
                resultD /= gcd;
                
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
            
            if (match) {
                return expr;
            }
            
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
            
            if (tempoTerms.length > 1) {
                const totalMultiplier = tempoTerms.reduce((sum, term) => sum + term.multiplier, 0);
                
                const isSimpleAddition = expr.replace(/new\s+Fraction\(60\)\.div\(module\.findTempo\(module\.baseNote\)\)\.mul\([^)]+\)/g, '')
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
                if (!e.includes('.add(')) {
                    return { type: 'term', value: e };
                }
                
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
            
            function analyzeTree(node) {
                const result = {
                    baseStartTime: false,
                    measureTerms: [],
                    tempoTerms: []
                };
                
                if (node.type === 'term') {
                    const term = node.value;
                    
                    if (term.includes("module.baseNote.getVariable('startTime')") && 
                        !term.includes('.add(')) {
                        result.baseStartTime = true;
                    }
                    
                    const complexMeasureMatch = term.match(/new\s+Fraction\((\d+)\)\.mul\(module\.findMeasureLength\(module\.baseNote\)\)/);
                    if (complexMeasureMatch) {
                        const multiplier = parseInt(complexMeasureMatch[1], 10);
                        if (!isNaN(multiplier)) {
                            result.measureTerms.push(multiplier);
                        }
                    }
                    
                    else if (term === 'module.findMeasureLength(module.baseNote)') {
                        result.measureTerms.push(1);
                    }
                    
                    const complexTempoMatch = term.match(/new\s+Fraction\(60\)\.div\(module\.findTempo\(module\.baseNote\)\)\.mul\(([^)]+)\)/);
                    if (complexTempoMatch) {
                        const multiplier = parseFloat(complexTempoMatch[1]);
                        if (!isNaN(multiplier)) {
                            result.tempoTerms.push(multiplier);
                        }
                    }
                    
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
            
            const parsedExpr = parseExpr(normalizedExpr);
            const analysis = analyzeTree(parsedExpr);
            
            console.log("Expression analysis:", analysis);
            
            if (analysis.baseStartTime && 
                (analysis.measureTerms.length > 0 || analysis.tempoTerms.length > 0)) {
                
                let newExpr = "module.baseNote.getVariable('startTime')";
                
                if (analysis.measureTerms.length > 0) {
                    const totalMeasures = analysis.measureTerms.reduce((sum, val) => sum + val, 0);
                    if (totalMeasures === 1) {
                        newExpr += ".add(module.findMeasureLength(module.baseNote))";
                    } else {
                        newExpr += `.add(new Fraction(${totalMeasures}).mul(module.findMeasureLength(module.baseNote)))`;
                    }
                }
                
                if (analysis.tempoTerms.length > 0) {
                    const totalMultiplier = analysis.tempoTerms.reduce((sum, val) => sum + val, 0);
                    if (totalMultiplier === 1) {
                        newExpr += `.add(new Fraction(60).div(module.findTempo(module.baseNote)))`;
                    } else {
                        newExpr += `.add(new Fraction(60).div(module.findTempo(module.baseNote)).mul(${totalMultiplier}))`;
                    }
                }
                
                console.log("New expression from tree parsing:", newExpr);
                
                try {
                    const originalFunc = new Function("module", "Fraction", "return " + expr + ";");
                    const newFunc = new Function("module", "Fraction", "return " + newExpr + ";");
                    
                    const originalValue = originalFunc(window.myModule, Fraction).valueOf();
                    const newValue = newFunc(window.myModule, Fraction).valueOf();
                    
                    console.log("Original value:", originalValue);
                    console.log("New value:", newValue);
                    
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
    
    function simplifyStartTimeExpression(expr) {
        try {
            const regexResult = simplifyStartTimeExpressionWithRegex(expr);
            
            if (regexResult === expr) {
                return parseAndSimplifyExpression(expr);
            }
            
            return regexResult;
        } catch (error) {
            console.error("Error in simplifyStartTimeExpression:", error);
            return expr;
        }
    }
    
    function simplifyStartTimeExpressionWithRegex(expr) {
        try {
            if (!expr.includes("module.baseNote.getVariable('startTime')")) {
                return expr;
            }
            
            console.log("Simplifying:", expr);
            
            const measureTerms = [];
            
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
            
            const simpleMeasureRegex = /module\.findMeasureLength\(module\.baseNote\)/g;
            let simpleMeasureMatch;
            tempExpr = expr;
            while ((simpleMeasureMatch = simpleMeasureRegex.exec(tempExpr)) !== null) {
                const beforeMatch = tempExpr.substring(0, simpleMeasureMatch.index);
                const lastMulIndex = beforeMatch.lastIndexOf(".mul(");
                
                if (lastMulIndex === -1 || simpleMeasureMatch.index - lastMulIndex > 50) {
                    measureTerms.push(1);
                    console.log("Found simple measure term");
                }
            }
            
            const tempoTerms = [];
            const simpleTempoRegex = /new\s+Fraction\(60\)\.div\(module\.findTempo\(module\.baseNote\)\)(?!\.mul)/g;
            let simpleTempoMatch;
            while ((simpleTempoMatch = simpleTempoRegex.exec(expr)) !== null) {
                tempoTerms.push(1);
                console.log("Found simple tempo term");
            }
            
            const complexTempoRegex = /new\s+Fraction\(60\)\.div\(module\.findTempo\(module\.baseNote\)\)\.mul\((?:new\s+Fraction\((\d+),\s*(\d+)\)|([^)]+))\)/g;
            let complexTempoMatch;
            while ((complexTempoMatch = complexTempoRegex.exec(expr)) !== null) {
                if (complexTempoMatch[1] !== undefined && complexTempoMatch[2] !== undefined) {
                    const numerator = parseInt(complexTempoMatch[1], 10);
                    const denominator = parseInt(complexTempoMatch[2], 10);
                    if (!isNaN(numerator) && !isNaN(denominator) && denominator !== 0) {
                        const multiplier = numerator / denominator;
                        tempoTerms.push(multiplier);
                        console.log("Found complex tempo term with fraction multiplier:", multiplier);
                    }
                } else if (complexTempoMatch[3] !== undefined) {
                    const multiplier = parseFloat(complexTempoMatch[3]);
                    if (!isNaN(multiplier)) {
                        tempoTerms.push(multiplier);
                        console.log("Found complex tempo term with multiplier:", multiplier);
                    }
                }
            }
            
            console.log("Measure terms:", measureTerms);
            console.log("Tempo terms:", tempoTerms);
            
            if (measureTerms.length > 0 || tempoTerms.length > 0) {
                let newExpr = "module.baseNote.getVariable('startTime')";
                
                if (measureTerms.length > 0) {
                    const totalMeasures = measureTerms.reduce((sum, val) => sum + val, 0);
                    if (totalMeasures === 1) {
                        newExpr += ".add(module.findMeasureLength(module.baseNote))";
                    } else {
                        newExpr += `.add(new Fraction(${totalMeasures}).mul(module.findMeasureLength(module.baseNote)))`;
                    }
                }
                
                if (tempoTerms.length > 0) {
                    const totalMultiplier = tempoTerms.reduce((sum, val) => sum + val, 0);
                    if (totalMultiplier === 1) {
                        newExpr += `.add(new Fraction(60).div(module.findTempo(module.baseNote)))`;
                    } else {
                        const fracObj = new Fraction(totalMultiplier);
                        newExpr += `.add(new Fraction(60).div(module.findTempo(module.baseNote)).mul(new Fraction(${fracObj.n}, ${fracObj.d})))`;
                    }
                }
                
                console.log("New expression:", newExpr);
                
                try {
                    const originalFunc = new Function("module", "Fraction", "return " + expr + ";");
                    const newFunc = new Function("module", "Fraction", "return " + newExpr + ";");
                    
                    const originalValue = originalFunc(window.myModule, Fraction).valueOf();
                    const newValue = newFunc(window.myModule, Fraction).valueOf();
                    
                    console.log("Original value:", originalValue);
                    console.log("New value:", newValue);
                    
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

    function evaluateEntireModule() {
        const noteIds = Object.keys(window.myModule.notes)
            .map(id => parseInt(id, 10))
            .filter(id => id !== 0);
        
        noteIds.sort((a, b) => a - b);
        
        let successCount = 0;
        let skippedCount = 0;
        
        const failedNotes = [];
        
        for (const noteId of noteIds) {
            try {
                const note = window.myModule.getNoteById(noteId);
                if (!note) continue;
                
                const isMeasureNote = note.variables.startTime && 
                                     !note.variables.duration && 
                                     !note.variables.frequency;
                
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
                        newExpr = replaceNoteReferencesWithBaseNoteOnly(originalExpr, window.myModule);
                        
                        const testFunc = new Function("module", "Fraction", "return " + newExpr + ";");
                        const testResult = testFunc(window.myModule, Fraction);
                        
                        if (Math.abs(testResult.valueOf() - originalValue) < 0.0001) {
                            note.setVariable(varName, function() {
                                return new Function("module", "Fraction", "return " + newExpr + ";")(window.myModule, Fraction);
                            });
                            note.setVariable(varName + 'String', newExpr);
                            noteSuccess = true;
                        } else {
                            const directExpr = createDirectExpression(varName, originalValue, window.myModule);
                            
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
        
        for (const failedNote of failedNotes) {
            try {
                const note = window.myModule.getNoteById(failedNote.noteId);
                if (!note) continue;
                
                const varName = failedNote.varName;
                const originalValue = failedNote.originalValue;
                
                const directExpr = createDirectExpression(varName, originalValue, window.myModule);
                
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
        
        function createDirectExpression(varName, value, moduleInstance) {
            const baseNote = moduleInstance.baseNote;
            
            if (varName === 'startTime') {
                const baseStartTime = baseNote.getVariable('startTime').valueOf();
                const offset = value - baseStartTime;
                
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
        
        for (const noteId of noteIds) {
            recompileNoteAndDependents(noteId);
        }
        
        window.evaluatedNotes = window.myModule.evaluateModule();
        externalFunctions.updateVisualNotes(window.evaluatedNotes);
        
        showNotification(`Module evaluation complete: ${successCount} notes processed, ${skippedCount} notes skipped`, 'success');
    }
    
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

    function getDurationImageForBase(base) {
        if (base === 4) return "whole.png";
        else if (base === 2) return "half.png";
        else if (base === 1) return "quarter.png";
        else if (base === 0.5) return "eighth.png";
        else if (base === 0.25) return "sixteenth.png";
        return "";
    }

    function recompileNoteAndDependents(noteId, visited = new Set()) {
        if (visited.has(noteId)) return;
        visited.add(noteId);
        const note = window.myModule.getNoteById(noteId);
        if (!note) return;
        Object.keys(note.variables).forEach(varKey => {
            if (varKey.endsWith("String")) {
                const baseKey = varKey.slice(0, -6);
                try {
                    const rawExpr = note.variables[varKey];
                    const newFunc = new Function("module", "Fraction", "return " + rawExpr + ";");
                    note.setVariable(baseKey, function() {
                        return newFunc(window.myModule, Fraction);
                    });
                } catch (err) {
                    console.error("Error recompiling note", noteId, "variable", baseKey, ":", err);
                }
            }
        });
        const dependents = window.myModule.getDependentNotes(noteId);
        dependents.forEach(depId => {
            recompileNoteAndDependents(depId, visited);
        });
    }

    function clearSelection() {
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
        } else {
          console.warn("originalNoteOrder not found in externalFunctions");
        }
    }

    function updateNoteWidgetHeight() {
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
            if (window.playerState && window.playerState.isPlaying && !window.playerState.isPaused && window.playerControls && window.playerControls.pause) {
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

    let dependencyGraphCache = null;
    let lastGraphUpdateTime = 0;

    function detectCircularDependency(moduleInstance, noteId, expression, variableType) {
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

    function invalidateDependencyGraphCache() {
        dependencyGraphCache = null;
    }

    function setExternalFunctions(functions) {
        externalFunctions = { ...externalFunctions, ...functions };
    }

    function init() {
        domCache.closeWidgetBtn.addEventListener('click', () => {
            clearSelection();
        });

        window.addEventListener('resize', handleWindowResize);

        addDraggableNoteWidget();

        updateNoteWidgetHeight();
    }

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

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
