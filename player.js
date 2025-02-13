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
document.addEventListener('DOMContentLoaded', async function() {
    const MAX_VOICES = 4;
    const INITIAL_VOLUME = 1 / MAX_VOICES;
    const ATTACK_TIME_RATIO = 0.1;
    const DECAY_TIME_RATIO = 0.1;
    const SUSTAIN_LEVEL = 0.7;
    const RELEASE_TIME_RATIO = 0.2;
    const GENERAL_VOLUME_RAMP_TIME = 0.2;
    let scheduledTimeouts = [];
    let currentTime = 0;
    let playheadTime = 0;
    let isPlaying = false;
    let isPaused = false;
    let isFadingOut = false;
    let pausedAtTime = 0;
    let totalPausedTime = 0;
    let oscillators = [];
    let isTrackingEnabled = false;
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    const DRAG_THRESHOLD = 5;

    /* ---------- DELETE DEPENDENCIES FUNCTIONALITY ---------- */

    /* Show a confirmation modal for deletion */
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
            deleteNoteAndDependencies(noteId);
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

    /* Delete the target note and all of its dependent notes */
    function deleteNoteAndDependencies(noteId) {
        const dependents = myModule.getDependentNotes(noteId);
        const idsToDelete = new Set([noteId, ...dependents]);
        //console.log("Deleting notes:", Array.from(idsToDelete));

        idsToDelete.forEach(id => {
            if (id !== 0) {
                delete myModule.notes[id];
            }
        });

        evaluatedNotes = myModule.evaluateModule();
        updateVisualNotes(evaluatedNotes);
        createMeasureBars();
        clearSelection();
    }

    /* ---------- KEEP DEPENDENCIES FUNCTIONALITY ---------- */

    /* Show confirmation modal for "Keep Dependencies" deletion */
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
            deleteNoteKeepDependencies(noteId);
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

    /* ---------- Revised updateDependentRawExpressions ----------
    For every dependent note (that depends on the soon-deleted note with id = selectedNoteId),
    we search its raw string expressions for any reference that calls either:
        module.getNoteById(selectedNoteId).getVariable('X')
    or:
        targetNote.getVariable('X')
    For each such occurrence, we replace it with the corresponding raw snapshot stored in selectedRaw.
    Note: We do not wrap the replacement in extra parentheses so that the functional raw expression is preserved.
    */
    function updateDependentRawExpressions(selectedNoteId, selectedRaw) {
        const regex = new RegExp(
        "(?:module\\.)?getNoteById\\(\\s*" + selectedNoteId + "\\s*\\)\\.getVariable\\('([^']+)'\\)|targetNote\\.getVariable\\('([^']+)'\\)",
        "g"
        );

        const dependents = myModule.getDependentNotes(selectedNoteId);
        dependents.forEach(depId => {
            const depNote = myModule.getNoteById(depId);
            if (!depNote) {
                console.warn("Dependent note", depId, "not found.");
                return;
            }
            Object.keys(depNote.variables).forEach(key => {
                if (key.endsWith("String")) {
                    let rawExp = depNote.variables[key];
                    if (typeof rawExp !== "string") {
                        console.warn("Skipping update for key", key, "in dependent note", depId, "as value is not a string:", rawExp);
                        return;
                    }
                    // Replace references to the soon-deleted note with its raw snapshot.
                    rawExp = rawExp.replace(regex, (match, g1, g2) => {
                        const varName = g1 || g2;
                        let replacement = selectedRaw[varName];
                        if (replacement === undefined) {
                            // Supply default: new Fraction(1,1) for frequency; for others, new Fraction(0,1)
                            replacement = (varName === "frequency") ? "new Fraction(1,1)" : "new Fraction(0,1)";
                            console.warn("No raw value for", varName, "– using default", replacement);
                        }
                        // Return the replacement without adding extra parentheses.
                        return replacement;
                    });
                    depNote.variables[key] = rawExp;
                    const baseKey = key.slice(0, -6);
                    try {
                        const newFunc = new Function("module", "Fraction", "return " + rawExp + ";");
                        depNote.setVariable(baseKey, function() {
                            return newFunc(myModule, Fraction);
                        });
                    } catch (err) {
                        console.error("Error compiling new expression for note", depId, "variable", baseKey, ":", err);
                    }
                }
            });
        });
    }

    /* ---------- Revised deleteNoteKeepDependencies ----------
        When deleting a note using "Keep Dependencies," for each variable among startTime, duration, and frequency,
        we check if a raw expression (e.g., startTimeString) already exists. If it does, we use that to preserve the
        functional form. Otherwise, we generate a literal snapshot. The snapshot is then used in updateDependentRawExpressions.
    */
    function deleteNoteKeepDependencies(noteId) {
        const selectedNote = myModule.getNoteById(noteId);
        if (!selectedNote) return;
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
        // Update all dependent notes so that references to the soon-deleted note now use the raw snapshot.
        updateDependentRawExpressions(noteId, selectedRaw);
        
        if (noteId !== 0) {
            delete myModule.notes[noteId];
        }
        
        evaluatedNotes = myModule.evaluateModule();
        updateVisualNotes(evaluatedNotes);
        createMeasureBars();
        clearSelection();
    }

    /* ---------- END KEEP DEPENDENCIES FUNCTIONALITY ---------- */

    /* ---------- GLOBAL HELPERS FOR MEASURE ADD FUNCTIONALITY ---------- */
    function hasMeasurePoints() {
        return Object.values(myModule.notes).some(note =>
          note.variables.startTime && 
          !note.variables.duration && 
          !note.variables.frequency
        );
      }
      
      function getLastMeasureId() {
        const measureNotes = [];
        for (const id in myModule.notes) {
          const note = myModule.notes[id];
          if (note.variables.startTime && !note.variables.duration && !note.variables.frequency) {
            measureNotes.push(note);
          }
        }
        if (measureNotes.length === 0) return null;
        
        let lastMeasure = measureNotes[0];
        for (let i = 1; i < measureNotes.length; i++) {
          if (measureNotes[i].getVariable('startTime').valueOf() > lastMeasure.getVariable('startTime').valueOf()) {
            lastMeasure = measureNotes[i];
          }
        }
        return lastMeasure.id;
      }
      
      function getModuleEndTime() {
        let measureEnd = 0;
        const measureNotes = Object.values(myModule.notes).filter(note =>
            note.variables.startTime && !note.variables.duration && !note.variables.frequency
        );
        if (measureNotes.length > 0) {
            measureNotes.sort((a, b) => a.getVariable('startTime').valueOf() - b.getVariable('startTime').valueOf());
            const lastMeasure = measureNotes[measureNotes.length - 1];
            measureEnd = lastMeasure.getVariable('startTime')
                .add(myModule.findMeasureLength(lastMeasure))
                .valueOf();
        }
      
        let lastNoteEnd = 0;
        Object.values(myModule.notes).forEach(note => {
            if (note.variables.startTime && note.variables.duration && note.variables.frequency) {
                const noteStart = note.getVariable('startTime').valueOf();
                const noteDuration = note.getVariable('duration').valueOf();
                const noteEnd = noteStart + noteDuration;
                if (noteEnd > lastNoteEnd) {
                    lastNoteEnd = noteEnd;
                }
            }
        });
      
        return Math.max(measureEnd, lastNoteEnd);
    }

    /* ---------- END GLOBAL HELPERS FOR MEASURE ADD FUNCTIONALITY ---------- */

    let myModule = await Module.loadFromJSON('moduleSetup.json');
    window.myModule = myModule;
    let evaluatedNotes = myModule.evaluateModule();
    let newNotes = Object.keys(evaluatedNotes).map(id => evaluatedNotes[id]).filter(note => 
        note.startTime && note.duration && note.frequency
    );

    const viewport = tapspace.createView('.myspaceapp');
    viewport.zoomable({
        keyboardPanArrows: true,
        keyboardPanWasd: false,
        keyboardZoomPlusMinus: true,
        wheelZoomInvert: false
    });

    const gestureCapturer = viewport.capturer('gesture', {
        preventDefault: false,
        stopPropagation: false
    });    
    gestureCapturer.on('gestureend', handleBackgroundGesture);

    const space = tapspace.createSpace();
    viewport.addChild(space);
    let centerPoint = null;  // Declare centerPoint globally

    const noteWidget = document.getElementById('note-widget');
    const closeWidgetBtn = document.querySelector('.note-widget-close');
    let currentSelectedNote = null;

    const saveModuleBtn = document.getElementById('saveModuleBtn');
    if (saveModuleBtn) {
        saveModuleBtn.addEventListener('click', saveModule);
    } else {
        console.error('Save Module button not found!');
    }

    /* ----------------------- FIXED IMPORT MODULE FUNCTION ----------------------- */
    //(async function() {
        /* ---------- In importModuleAtTarget (ensure deletion is handled separately) ----------
    For dropped modules, we want to rewrite any reference to the base note (id 0)
    to leave targetNote references intact (so that imported expressions remain chainable).
    Deletion will later remove any targetNote references.
    (No changes shown here; ensure that your importModuleAtTarget continues to replace base note references properly.)
    */
    async function importModuleAtTarget(targetNote, moduleData) {
        try {
          const importedModule = await Module.loadFromJSON(moduleData);
      
          // Build a mapping from the imported module note ids to new ids in myModule.
          const mapping = {};
          mapping[0] = targetNote.id;
          const currentIds = Object.keys(myModule.notes).map(id => Number(id));
          let maxId = currentIds.length > 0 ? Math.max(...currentIds) : 0;
          let newId = maxId + 1;
          for (const id in importedModule.notes) {
            if (Number(id) === 0) continue;
            mapping[id] = newId;
            newId++;
          }
      
          function updateExpression(expr) {
            // For a drop target that is not the base note, we want the imported module’s base note references
            // to be relative—i.e. not refer back to the target note itself, which creates recursion.
            // Instead, if the target note has a parentId, we replace occurrences of
            // "module.baseNote.getVariable('varName')" with "module.getNoteById(targetNote.parentId).getVariable('varName')".
            // If targetNote.parentId is undefined, we default to 0.
            if (targetNote.id !== 0) {
              // Determine the appropriate note to use for relative base values.
              let relativeId = (typeof targetNote.parentId !== 'undefined' && targetNote.parentId !== null)
                ? targetNote.parentId
                : 0;
                
              expr = expr.replace(/module\.baseNote\.getVariable\(\s*'([^']+)'\s*\)/g, function(match, varName) {
                return "module.getNoteById(" + relativeId + ").getVariable('" + varName + "')";
              });
            } else {
              // If dropping on the base note, leave module.baseNote references unchanged.
              expr = expr.replace(/module\.baseNote/g, "module.baseNote");
            }
          
            // Additionally, update any module.getNoteById(<number>) references based on the mapping.
            expr = expr.replace(/module\.getNoteById\(\s*(\d+)\s*\)/g, function(match, p1) {
              const oldRef = parseInt(p1, 10);
              if (mapping.hasOwnProperty(oldRef)) {
                return "module.getNoteById(" + mapping[oldRef] + ")";
              }
              return match;
            });
          
            return expr;
          }
      
          // Process the imported notes (other than the base).
          for (const id in importedModule.notes) {
            if (Number(id) === 0) continue;
            const impNote = importedModule.notes[id];
            const oldId = impNote.id;
            impNote.id = mapping[oldId];
            if (typeof impNote.parentId !== 'undefined') {
              const oldParent = impNote.parentId;
              if (mapping.hasOwnProperty(oldParent)) {
                impNote.parentId = mapping[oldParent];
              } else {
                impNote.parentId = targetNote.id;
              }
            }
            for (const key in impNote.variables) {
              if (typeof impNote.variables[key] === 'string' && key.endsWith("String")) {
                let originalString = impNote.variables[key];
                impNote.variables[key] = updateExpression(originalString);
                const baseKey = key.slice(0, -6);
                impNote.setVariable(baseKey, function() {
                  return new Function("module", "Fraction", "return " + impNote.variables[key] + ";")(myModule, Fraction);
                });
              } else if (key === 'color') {
                impNote.variables.color = impNote.variables.color;
              }
            }
            myModule.notes[impNote.id] = impNote;
          }
      
          const evaluatedNotes = myModule.evaluateModule();
          updateVisualNotes(evaluatedNotes);
          createMeasureBars();
          
        } catch (error) {
          console.error("Error importing module at target note:", error);
        }
      }
    window.importModuleAtTarget = importModuleAtTarget;
//      })();
    /* ----------------------- END FIXED IMPORT MODULE FUNCTION ----------------------- */

    function showNoteVariables(note, clickedElement, measureId = null) {
        const effectiveNoteId = (note && note.id !== undefined) ? note.id : measureId;
        if (effectiveNoteId === undefined) {
            console.error("No valid note id found for dependency highlighting.");
            return;
        }
        
        const widgetContent = document.querySelector('.note-widget-content');
        const widgetTitle = document.getElementById('note-widget-title');
        
        if (note === myModule.baseNote) {
            widgetTitle.textContent = 'BaseNote Variables';
        } else if (measureId !== null) {
            widgetTitle.textContent = `Measure [${measureId}] Variables`;
        } else {
            widgetTitle.textContent = `Note [${effectiveNoteId || 'unknown'}] Variables`;
        }
        
        widgetContent.innerHTML = '';
        
        // Clear only the selection highlight, keep dependency and dependent classes
        document.querySelectorAll('.note-content.selected, .base-note-circle.selected, .measure-bar-triangle.selected').forEach(el => el.classList.remove('selected'));
        
        // Clear previous dependency highlights
        document.querySelectorAll('.dependency, .dependent').forEach(el => {
            el.classList.remove('dependency', 'dependent');
        });
        
        if (clickedElement) {
            clickedElement.classList.add('selected');
        }
        
        if (note !== myModule.baseNote && effectiveNoteId !== undefined) {
            const selfNoteId = effectiveNoteId;
            const directDeps = myModule.getDirectDependencies(selfNoteId).filter(depId => depId !== selfNoteId);
            directDeps.forEach(depId => {
                if (depId === 0) {
                    const baseNoteElement = document.querySelector('.base-note-circle');
                    if (baseNoteElement) {
                        baseNoteElement.classList.add('dependency');
                    }
                } else {
                    let depElement = document.querySelector(`.note-content[data-note-id="${depId}"]`);
                    if (!depElement) {
                        depElement = document.querySelector(`.measure-bar-triangle[data-note-id="${depId}"]`);
                    }
                    if (depElement) {
                        depElement.classList.add('dependency');
                    }
                }
            });
        
            const dependents = myModule.getDependentNotes(selfNoteId).filter(depId => depId !== selfNoteId);
            dependents.forEach(depId => {
                let depElement = document.querySelector(`.note-content[data-note-id="${depId}"]`);
                if (!depElement) {
                    depElement = document.querySelector(`.measure-bar-triangle[data-note-id="${depId}"]`);
                }
                if (depElement) {
                    depElement.classList.add('dependent');
                }
            });
        }
        
        let variables = {};
        if (note === myModule.baseNote) {
            Object.keys(note.variables).forEach(key => {
                if (!key.endsWith('String') && key !== 'measureLength') {
                    variables[key] = {
                        evaluated: note.getVariable(key),
                        raw: note.variables[key + 'String'] || note.variables[key].toString()
                    };
                }
            });
        } else if (measureId !== null) {
            const noteInstance = myModule.getNoteById(parseInt(measureId, 10));
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
                        }
                    } else {
                        const currentNoteId = measureId !== null ? measureId : note.id;
                        const validatedExpression = validateExpression(myModule, currentNoteId, newRawValue, key);
                        
                        if(measureId !== null) {
                            const measureNote = myModule.getNoteById(measureId);
                            if (measureNote) {
                                measureNote.setVariable(key, () => { 
                                    return eval(`(function(module, Fraction) { return ${validatedExpression}; })`)(myModule, Fraction); 
                                });
                                measureNote.setVariable(key + 'String', newRawValue); // Store the raw input
                            } else { 
                                throw new Error('Unable to find measure note'); 
                            }
                        } else {
                            note.setVariable(key, () => { 
                                return eval(`(function(module, Fraction) { return ${validatedExpression}; })`)(myModule, Fraction); 
                            });
                            note.setVariable(key + 'String', newRawValue); // Store the raw input
                        }
                    }
            
                    if (note === myModule.baseNote) {
                        updateBaseNoteFraction();
                        updateBaseNotePosition();
                    }
                    
                    evaluatedNotes = myModule.evaluateModule();
                    updateVisualNotes(evaluatedNotes);
                    
                    // Ensure the current note or measure bar remains selected
                    const updatedElement = document.querySelector(`[data-note-id="${effectiveNoteId}"]`);
                    if (updatedElement) {
                        updatedElement.classList.add('selected');
                    }
            
                    // Update dependency highlights
                    if (note !== myModule.baseNote && effectiveNoteId !== undefined) {
                        const directDeps = myModule.getDirectDependencies(effectiveNoteId).filter(depId => depId !== effectiveNoteId);
                        directDeps.forEach(depId => {
                            if (depId === 0) {
                                const baseNoteElement = document.querySelector('.base-note-circle');
                                if (baseNoteElement) {
                                    baseNoteElement.classList.add('dependency');
                                }
                            } else {
                                let depElement = document.querySelector(`.note-content[data-note-id="${depId}"], .measure-bar-triangle[data-note-id="${depId}"]`);
                                if (depElement) {
                                    depElement.classList.add('dependency');
                                }
                            }
                        });
            
                        const dependents = myModule.getDependentNotes(effectiveNoteId).filter(depId => depId !== effectiveNoteId);
                        dependents.forEach(depId => {
                            let depElement = document.querySelector(`.note-content[data-note-id="${depId}"], .measure-bar-triangle[data-note-id="${depId}"]`);
                            if (depElement) {
                                depElement.classList.add('dependent');
                            }
                        });
                    }
            
                    // Update only the evaluated value
                    evaluatedDiv.innerHTML = `<span class="value-label">Evaluated:</span> ${note.getVariable(key) !== null ? String(note.getVariable(key)) : 'null'}`;
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
        if (note === myModule.baseNote && !hasMeasurePoints()) {
            shouldShowAdd = true;
        } else if (measureId !== null && String(measureId) === String(getLastMeasureId())) {
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
                let newMeasures = [];
              
                if (note === myModule.baseNote && !hasMeasurePoints()) {
                    const newMeasure = myModule.addNote({
                        startTime: () => myModule.baseNote.getVariable('startTime'),
                        startTimeString: "module.baseNote.getVariable('startTime')"
                    });
                    newMeasure.parentId = myModule.baseNote.id;
                    newMeasures.push(newMeasure);
                } else {
                    const fromNote = (note === myModule.baseNote) ? myModule.baseNote : myModule.getNoteById(measureId);
                    newMeasures = myModule.generateMeasures(fromNote, 1);
                }
              
                newMeasures.forEach(measure => {
                    measure.getVariable('startTime');
                });
              
                setTimeout(() => {
                    updateTimingBoundaries();
                    createMeasureBars();
                    evaluatedNotes = myModule.evaluateModule();
              
                    const newLast = getLastMeasureId();
                    if (newLast !== null) {
                        const measureTriangle = document.querySelector(`.measure-bar-triangle[data-note-id="${newLast}"]`);
                        showNoteVariables(myModule.getNoteById(parseInt(newLast)), measureTriangle, parseInt(newLast));
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
        
        if (note !== myModule.baseNote) {
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
        
        noteWidget.classList.add('visible');
        widgetInitiallyOpened = true;
        updateNoteWidgetHeight();
    }
    
    function clearSelection() {
        noteWidget.classList.remove('visible');
        currentSelectedNote = null;
        document.querySelectorAll(
            '.note-content.selected, .base-note-circle.selected, .measure-bar-triangle.selected, ' +
            '.note-content.dependency, .note-content.dependent, .base-note-circle.dependency, .measure-bar-triangle.dependency, .measure-bar-triangle.dependent'
        ).forEach(el => el.classList.remove('selected', 'dependency', 'dependent'));
        
        const baseNoteCircle = document.getElementById('baseNoteCircle');
        if (baseNoteCircle) {
            baseNoteCircle.classList.remove('selected', 'dependency', 'dependent');
        }
    }
    
    closeWidgetBtn.addEventListener('click', () => {
        clearSelection();
    });
    
    function addNoteClickHandler(noteElement, note) {
        const noteRect = noteElement.element.querySelector('.note-rect');
        const noteContent = noteElement.element.querySelector('.note-content');
        if (noteRect && noteContent) {
            noteRect.addEventListener('click', (event) => {
                event.stopPropagation();
                currentSelectedNote = note;
                showNoteVariables(note, noteContent);
            });
        }
    }
    
    function setupBaseNoteClickHandler() {
        const baseNoteCircle = document.getElementById('baseNoteCircle');
        const baseNoteElement = baseNoteCircle.querySelector('.base-note-circle');
        if (baseNoteCircle && baseNoteElement) {
            baseNoteCircle.addEventListener('click', (event) => {
                event.stopPropagation();
                currentSelectedNote = myModule.baseNote;
                showNoteVariables(myModule.baseNote, baseNoteElement);
            });
        }
    }
    
    function updateZoomableBehavior() {
        if (isTrackingEnabled) {
            viewport.zoomable(false);
        } else {
            viewport.zoomable({
                keyboardPanArrows: true,
                keyboardPanWasd: false,
                keyboardZoomPlusMinus: true,
                wheelZoomInvert: false
            });
        }
    }
    
    function frequencyToY(freq) {
        return -Math.log2(freq) * 100;
    }
    
    function createBaseNoteDisplay() {
        const baseNoteFreq = myModule.baseNote.getVariable('frequency').valueOf();
        const baseNoteY = frequencyToY(baseNoteFreq);
        const x = -50;
        const yOffset = -11;
      
        // Create the base note circle using tapspace.
        const baseNoteCircle = tapspace.createItem(`
          <div class="base-note-circle" style="
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background-color: #ffa800;
            border: 1px solid #636363;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: border-color 0.3s ease, box-shadow 0.3s ease;
          ">
            <div class="base-note-fraction">
              <div class="fraction-numerator"></div>
              <div class="fraction-line"></div>
              <div class="fraction-denominator"></div>
            </div>
          </div>
        `);
      
        // Add a data-note-id attribute so that mobile pointerup handlers can detect it.
        baseNoteCircle.element.setAttribute('data-note-id', myModule.baseNote.id);
      
        // Retrieve the inner element for hover effects.
        const baseNoteContent = baseNoteCircle.element.querySelector('.base-note-circle');
        baseNoteCircle.element.addEventListener('mouseenter', () => {
          baseNoteContent.style.borderColor = 'white';
          baseNoteContent.style.boxShadow =
            '0 0 5px #ffa800, 0 0 10px #ffa800, 0 0 15px #ffa800';
        });
        baseNoteCircle.element.addEventListener('mouseleave', () => {
          baseNoteContent.style.borderColor = '#636363';
          baseNoteContent.style.boxShadow = 'none';
        });
      
        // --- Allow dropping a module on the base note ---
        baseNoteCircle.element.addEventListener('dragover', (event) => {
          event.preventDefault();
        }, true);
      
        baseNoteCircle.element.addEventListener('drop', (event) => {
          event.preventDefault();
          try {
            let data = event.dataTransfer.getData('application/json');
            if (!data) {
              data = event.dataTransfer.getData('text/plain');
            }
            if (data) {
              const moduleData = JSON.parse(data);
              importModuleAtTarget(myModule.baseNote, moduleData);
            }
          } catch (err) {
            console.error("Error during drop on base note:", err);
          }
        }, true);
      
        // For mobile: add pointerup to capture drop events on touch devices.
        baseNoteCircle.element.addEventListener('pointerup', function(e) {
          if (e.pointerType === 'touch') {
            // The element now has a data-note-id so the standard mobile pointerup in module-icons.js will work.
            // (If desired, additional handling can be implemented here.)
          }
        }, true);
        // --- End drop functionality addition ---
      
        baseNoteCircle.element.id = 'baseNoteCircle';
        baseNoteCircle.setSize({ width: 40, height: 40 });
        space.addChild(baseNoteCircle, { x: x, y: baseNoteY + yOffset });
      
        updateBaseNoteFraction();
        setupBaseNoteClickHandler();
      
        centerPoint = space.at(0, baseNoteY);
        viewport.translateTo(centerPoint);
      
        return baseNoteCircle;
    }
    
    function updateBaseNoteFraction() {
        const baseNoteFreq = myModule.baseNote.getVariable('frequency');
        let numerator, denominator;
        if (baseNoteFreq instanceof Fraction) {
            numerator = baseNoteFreq.n;
            denominator = baseNoteFreq.d;
        } else {
            numerator = baseNoteFreq.toString();
            denominator = '1';
        }
        const numeratorDisplay = document.querySelector('.fraction-numerator');
        const denominatorDisplay = document.querySelector('.fraction-denominator');
        if (numeratorDisplay && denominatorDisplay) {
            numeratorDisplay.textContent = numerator;
            denominatorDisplay.textContent = denominator;
        }
    }
    
    function updateBaseNotePosition() {
        const baseNoteFreq = myModule.baseNote.getVariable('frequency').valueOf();
        const baseNoteY = frequencyToY(baseNoteFreq);
        const x = -50;
        const yOffset = -10;
    
        const baseNoteCircle = space.getChildren().find(child => child.element.id === 'baseNoteCircle');
        if (baseNoteCircle) {
            baseNoteCircle.translateTo(space.at(x, baseNoteY + yOffset));
        }
    }
    
    let baseNoteFreq = myModule.baseNote.getVariable('frequency').valueOf();
    let baseNoteY = frequencyToY(baseNoteFreq);
    
    let baseNoteDisplay = createBaseNoteDisplay();
    
    centerPoint = space.at(0, baseNoteY);
    viewport.translateTo(centerPoint);
    
    let earliestStart = Infinity;
    let latestEnd = 0;
    let lowestFreq = Infinity;
    let highestFreq = 0;
    
    function updateTimingBoundaries() {
        earliestStart = Infinity;
        latestEnd = 0;
        lowestFreq = Infinity;
        highestFreq = 0;
    
        const baseStart = myModule.baseNote.getVariable('startTime')?.valueOf() ?? 0;
        earliestStart = baseStart;
        if (newNotes && newNotes.length > 0) {
            newNotes.forEach(note => {
                if (note) {
                    const startTime = note.startTime?.valueOf() ?? 0;
                    const duration = note.duration?.valueOf() ?? 0;
                    const freq = note.frequency?.valueOf() ?? 440;
                    earliestStart = Math.min(earliestStart, startTime);
                    latestEnd = Math.max(latestEnd, startTime + duration);
                    lowestFreq = Math.min(lowestFreq, freq);
                    highestFreq = Math.max(highestFreq, freq);
                }
            });
        }
        if (evaluatedNotes) {
            Object.values(evaluatedNotes).forEach(note => {
                if (note && note.startTime) {
                    const startTime = note.startTime?.valueOf() ?? 0;
                    const duration = note.duration?.valueOf() ?? 0;
                    const endTime = startTime + duration;
                    earliestStart = Math.min(earliestStart, startTime);
                    latestEnd = Math.max(latestEnd, endTime);
                    if (note.frequency) {
                        const freq = note.frequency?.valueOf() ?? 440;
                        lowestFreq = Math.min(lowestFreq, freq);
                        highestFreq = Math.max(highestFreq, freq);
                    }
                }
            });
        }
    }
    
    updateTimingBoundaries();
    
    let measureBars = [];
    let playhead = null;
    let playheadContainer = null;
    
    function cleanupAudio() {
        scheduledTimeouts.forEach(timeout => clearTimeout(timeout));
        scheduledTimeouts = [];
        oscillators.forEach(oscObj => {
            try {
                oscObj.gainNode.gain.cancelScheduledValues(audioContext.currentTime);
                oscObj.oscillator.stop();
                oscObj.oscillator.disconnect();
                oscObj.gainNode.disconnect();
            } catch (e) {
                console.log('Oscillator already stopped');
            }
        });
        oscillators = [];
        if (audioContext.state !== 'running') {
            audioContext.close().then(() => {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
                generalVolumeGainNode = audioContext.createGain();
                compressor = audioContext.createDynamicsCompressor();
                generalVolumeGainNode.connect(compressor);
                compressor.connect(audioContext.destination);
                setVolume(document.getElementById('volumeSlider').value);
            });
        }
    }
    
    function getFrequencyMultiplier(note) {
        if (note.variables && note.variables.color) {
            if (typeof note.variables.color === 'function') {
                return note.variables.color();
            }
            return note.variables.color;
        }
        const hue = Math.random() * 360;
        const newColor = `hsla(${hue}, 70%, 60%, 0.7)`;
        if (note.setVariable) {
            note.setVariable('color', newColor);
        } else {
            note.color = newColor;
        }
        return newColor;
    }
    
    /* --- New Helper: getFrequencyFraction ---
   Returns a fraction string from note.frequency (assuming note.getVariable returns 
   a Fraction object with a toFraction() method; if not, .toString() is used) */
function getFrequencyFraction(note) {
    if (note && note.getVariable && note.variables.frequency) {
      let freq = note.getVariable('frequency');
      if (freq instanceof Fraction && typeof freq.toFraction === "function") {
        return freq.toFraction(); // e.g. "4/3"
      } else {
        return freq.toString();
      }
    }
    return "1/1";
  }
  
  /* ---------- Helper: getFrequencyRatio ----------
   Returns the fraction string that represents the note’s frequency relative to the base note.
   It first tries to extract a raw fraction from note.variables.frequencyString.
   If the extracted string does not include a “/”, it appends “/1”.
   If no matching pattern is found, it falls back to computing based on evaluated values.
*/
function getFrequencyRatio(note) {
    if (note && note.variables && note.variables.frequencyString) {
      let raw = note.variables.frequencyString;
      // Try to match: new Fraction(a, b).mul( ... getVariable('frequency') ...)
      let m = raw.match(/new Fraction\(\s*([^,]+)\s*,\s*([^)]+)\s*\)\.mul\([^)]*getVariable\('frequency'\)[^)]*\)/);
      if (m) {
        let num = m[1].trim();
        let den = m[2].trim();
        if (!den.includes("/")) { // if missing denominator, default it to 1
          den = den + "/1";
        }
        return num + "/" + den;
      }
    }
    // Fallback: compute ratio by dividing evaluated frequency by the base note frequency.
    if (note && note.getVariable && note.variables.frequency) {
      let freq = note.getVariable('frequency');
      let base = myModule.baseNote.getVariable('frequency');
      if (freq && base && typeof freq.div === "function") {
        let ratio = freq.div(base);
        let fracStr = (typeof ratio.toFraction === "function") ? ratio.toFraction() : ratio.toString();
        if (!fracStr.includes("/")) {
          fracStr = fracStr + "/1";
        }
        return fracStr;
      }
    }
    return "1/1";
  }
  
  /* ---------- Revised createNoteElement ---------- */
  function createNoteElement(note, index) {
    const fractionStr = getFrequencyRatio(note);
    const parts = fractionStr.split('/');
    const numerator = parts[0] || "undefined";
    const denominator = parts[1] || "undefined";
  
    const noteColor = getColorForNote(note);
  
    const measureDiv = document.createElement('div');
    measureDiv.style.position = 'absolute';
    measureDiv.style.visibility = 'hidden';
    measureDiv.style.fontSize = '6px';
    measureDiv.style.fontFamily = "'Roboto Mono', 'IBM Plex Mono', monospace";
    measureDiv.style.fontWeight = '400';
    measureDiv.style.whiteSpace = 'nowrap';
    document.body.appendChild(measureDiv);
    measureDiv.textContent = numerator;
    const numWidth = measureDiv.offsetWidth;
    measureDiv.textContent = denominator;
    const denWidth = measureDiv.offsetWidth;
    document.body.removeChild(measureDiv);
    const maxWidth = Math.max(numWidth, denWidth);
  
    const noteRect = tapspace.createItem(`
        <div class="note-rect" style="
          overflow: visible;
          width: 100%;
          height: 100%;
          position: relative;
          pointer-events: auto;
          display: flex;
          align-items: center;
          box-sizing: border-box;
        ">
          <div class="note-content" data-note-id="${note.id}" style="
            overflow: hidden;    
            width: 100%;
            height: 100%;
            background-color: ${noteColor};
            border-radius: 6px;
            border: 1px solid #636363;
            transition: border-color 0.3s ease, box-shadow 0.3s ease;
            display: flex;
            align-items: center;
            padding-left: 4px;
            position: relative;
          ">
            <div class="note-id" style="
              position: absolute;
              top: 0;
              left: 2.5px;
              color: #ffa800;
              font-size: 2px;
              font-family: 'Roboto Mono', 'IBM Plex Mono', monospace;
              line-height: 1;
              padding: 1px;
            ">[${note.id}]</div>
            <div style="
              display: flex;
              align-items: center;
              font-size: 6px;
              font-family: 'Roboto Mono', 'IBM Plex Mono', monospace;
              font-weight: 400;
              color: white;
              text-shadow: 0 0 1px black;
              pointer-events: none;
              height: 100%;
            ">
              <div style="
                position: relative;
                display: flex;
                flex-direction: column;
                justify-content: center;
                height: 100%;
              ">
                <div style="
                  position: relative;
                  display: flex;
                  flex-direction: column;
                  align-items: flex-start;
                  gap: 0px;
                ">
                  <span>${numerator}</span>
                  <div style="
                    width: ${maxWidth}px;
                    height: 1px;
                    background: white;
                    margin: 0;
                  "></div>
                  <span>${denominator}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
    `);
  
    // Add the data-note-id attribute to the outer container for mobile drop detection.
    noteRect.element.setAttribute('data-note-id', note.id);
    
    const noteContent = noteRect.element.querySelector('.note-content');
    noteRect.element.addEventListener('mouseenter', () => {
      noteContent.style.borderColor = 'white';
      noteContent.style.boxShadow = '0 0 5px #ffa800, 0 0 10px #ffa800, 0 0 15px #ffa800';
    });
    noteRect.element.addEventListener('mouseleave', () => {
      noteContent.style.borderColor = '#636363';
      noteContent.style.boxShadow = 'none';
    });
    addNoteClickHandler(noteRect, note);
  
    // Desktop drag/drop events.
    noteRect.element.addEventListener('dragover', (event) => {
      event.preventDefault();
    }, true);
    noteRect.element.addEventListener('drop', (event) => {
      event.preventDefault();
      try {
        let data = event.dataTransfer.getData('application/json');
        if (!data) data = event.dataTransfer.getData('text/plain');
        if (data) {
          const moduleData = JSON.parse(data);
          importModuleAtTarget(note, moduleData);
        }
      } catch (err) {
        console.error("Error during desktop drop:", err);
      }
    }, true);
  
    return noteRect;
  }
  
    (function() {
        function createMeasureBarTriangle(measureBar, measurePoint, id) {
            if (!measurePoint) return null;
            const triangle = document.createElement('div');
            triangle.className = 'measure-bar-triangle';
            triangle.setAttribute("data-note-id", id);
            triangle.innerHTML = `<span class="measure-id">[${id}]</span>`;
            triangle.addEventListener('click', (event) => {
                event.stopPropagation();
                // Clear previous selections
                document.querySelectorAll('.note-content.selected, .base-note-circle.selected, .measure-bar-triangle.selected').forEach(el => {
                    el.classList.remove('selected');
                });
                // Add selected class to this triangle
                triangle.classList.add('selected');
                showNoteVariables(measurePoint, triangle, id);
            });
            return triangle;
        }
  
        window.createMeasureBarTriangle = createMeasureBarTriangle;
    })();
    
    function createMeasureBars() {
        // Store current selections
        const selectedMeasureBars = document.querySelectorAll('.measure-bar-triangle.selected');
        const selectedMeasureBarIds = Array.from(selectedMeasureBars).map(el => el.getAttribute('data-note-id'));
    
        measureBars.forEach(bar => bar.remove());
        measureBars = [];
        if (playhead) playhead.remove();
    
        const barsContainer = document.getElementById('measureBarsContainer');
        playheadContainer = document.getElementById('playheadContainer');
        const trianglesContainer = document.getElementById('measureBarTrianglesContainer');
    
        barsContainer.innerHTML = '';
        playheadContainer.innerHTML = '';
        trianglesContainer.innerHTML = '';
    
        playhead = document.createElement('div');
        playhead.className = 'playhead';
        playheadContainer.appendChild(playhead);
    
        const measurePoints = Object.entries(myModule.notes)
            .filter(([id, note]) => note.getVariable('startTime') && !note.getVariable('duration') && !note.getVariable('frequency'))
            .map(([id, note]) => ({ id: parseInt(id, 10), note }));
    
        const baseStart = myModule.baseNote.getVariable('startTime').valueOf();
        if (!measurePoints.some(mp => mp.note.getVariable('startTime').valueOf() === baseStart)) {
            const originBar = document.createElement('div');
            originBar.className = 'measure-bar';
            originBar.id = 'measure-bar-origin';
            originBar.setAttribute("data-x", 0);
            barsContainer.appendChild(originBar);
            measureBars.push(originBar);
        }
    
        measurePoints.forEach(({ id, note }) => {
            const bar = document.createElement('div');
            bar.className = 'measure-bar';
            bar.id = `measure-bar-${id}`;
            const x = note.getVariable('startTime').valueOf() * 200;
            bar.setAttribute("data-x", x);
            bar.setAttribute("data-note-id", id);
            barsContainer.appendChild(bar);
            measureBars.push(bar);
            const triangle = createMeasureBarTriangle(bar, note, id);
            if (triangle) {
                trianglesContainer.appendChild(triangle);
                // Reapply selection if this measure bar was previously selected
                if (selectedMeasureBarIds.includes(id.toString())) {
                    triangle.classList.add('selected');
                }
            }
        });
    
        const finalBar = document.createElement('div');
        finalBar.className = 'measure-bar';
        finalBar.id = `measure-bar-final`;
        barsContainer.appendChild(finalBar);
        measureBars.push(finalBar);
    
        updateMeasureBarPositions();
    }
    
    function updateMeasureBarPositions() {
        const transform = viewport.getBasis().getRaw();
        const scale = Math.sqrt(transform.a * transform.a + transform.b * transform.b);
    
        measureBars.forEach(bar => {
            let x = 0;
            if (bar.id === 'measure-bar-origin') {
                x = 0;
            } else if (bar.id === 'measure-bar-final') {
                const moduleEndTime = getModuleEndTime();
                x = moduleEndTime * 200;
            } else {
                const noteId = bar.getAttribute("data-note-id");
                if (noteId) {
                    const note = myModule.getNoteById(parseInt(noteId, 10));
                    if (note) {
                        x = note.getVariable('startTime').valueOf() * 200;
                    }
                }
            }
            const point = new tapspace.geometry.Point(space, { x: x, y: 0 });
            const screenPos = point.transitRaw(viewport);
            bar.style.transform = `translate(${screenPos.x}px, 0) scale(${1 / scale}, 1)`;
        });
    
        const triangles = document.querySelectorAll('.measure-bar-triangle');
        triangles.forEach(triangle => {
            const noteId = triangle.getAttribute("data-note-id");
            if (noteId) {
                const note = myModule.getNoteById(parseInt(noteId, 10));
                if (note) {
                    const x = note.getVariable('startTime').valueOf() * 200;
                    const point = new tapspace.geometry.Point(space, { x: x, y: 0 });
                    const screenPos = point.transitRaw(viewport);
                    triangle.style.transform = `translateX(${screenPos.x}px)`;
                }
            }
        });
    
        requestAnimationFrame(updateMeasureBarPositions);
    }
    
    function updatePlayhead() {
        const moduleEndTime = getModuleEndTime();
        if (!isPlaying && playheadTime > moduleEndTime) {
            playheadTime = moduleEndTime;
        }
        
        if (isPlaying && !isPaused && !isFadingOut) {
            playheadTime = Math.min(audioContext.currentTime - currentTime + totalPausedTime, moduleEndTime);
            if (playheadTime >= moduleEndTime) {
                stop(false);
                return;
            }
        }
        
        const x = playheadTime * 200;
        if (isTrackingEnabled) {
            const viewCenter = viewport.atCenter();
            const targetPoint = space.at(x, viewCenter.transitRaw(space).y);
            viewport.match({
                source: viewCenter,
                target: targetPoint,
                estimator: 'X'
            });
        }
        
        const transform = viewport.getBasis().getRaw();
        const scale = Math.sqrt(transform.a * transform.a + transform.b * transform.b);
        const point = new tapspace.geometry.Point(space, { x: x, y: 0 });
        const screenPos = point.transitRaw(viewport);
        playhead.style.transform = `translate(${screenPos.x}px, 0) scale(${1/scale}, 1)`;
        
        requestAnimationFrame(updatePlayhead);
    }
    
    function handleBackgroundGesture(gestureEvent) {
        if (gestureEvent.travel <= 5) {
            const clickedElement = gestureEvent.target;
            const isClickOnNote = clickedElement.element.closest('.note-rect') !== null;
            if (!isClickOnNote) {
                const clickPoint = gestureEvent.mean;
                const spacePoint = clickPoint.changeBasis(space);
                let newPlayheadTime = spacePoint.point.x / 200;
                newPlayheadTime = Math.max(0, Math.min(newPlayheadTime, getModuleEndTime()));
                playheadTime = newPlayheadTime;
                updatePlayhead();
                if (isPlaying) {
                    stop(false);
                }
                initAudioContext();
                currentTime = audioContext.currentTime;
                totalPausedTime = 0;
                if (isPlaying) {
                    stop(false);
                    play(playheadTime);
                }
            }
        }
    }
    
    createMeasureBars();
    // Update the visual representation of notes
    updateVisualNotes(evaluatedNotes);

    requestAnimationFrame(updatePlayhead);
    requestAnimationFrame(updateMeasureBarPositions);
    
    function getColorForNote(note) {
        if (note.variables && note.variables.color) {
            if (typeof note.variables.color === 'function') {
                return note.variables.color();
            }
            return note.variables.color;
        }
        const hue = Math.random() * 360;
        const newColor = `hsla(${hue}, 70%, 60%, 0.7)`;
        if (note.setVariable) {
            note.setVariable('color', newColor);
        } else {
            note.color = newColor;
        }
        return newColor;
    }
    
    function updateVisualNotes(evaluatedNotes) {
        // Store current selections before updating
        const selectedElements = document.querySelectorAll('.note-content.selected, .base-note-circle.selected, .measure-bar-triangle.selected');
        const selectedIds = Array.from(selectedElements).map(el => el.getAttribute('data-note-id'));
        
        // Clear existing notes (except base note)
        const currentNotes = space.getChildren();
        currentNotes.forEach(note => {
            if (note.element.id !== 'baseNoteCircle') {
                note.remove();
                space.removeChild(note);
            }
        });
    
        const baseStartTime = myModule.baseNote.getVariable('startTime').valueOf();
        newNotes = Object.entries(myModule.notes)
            .filter(([id, note]) => note.getVariable('startTime'))
            .map(([id, note]) => {
                const startTime = note.getVariable('startTime').valueOf();
                const duration = note.getVariable('duration')?.valueOf();
                const frequency = note.getVariable('frequency')?.valueOf();
                
                if (duration && frequency) {
                    // Regular note
                    const noteRect = createNoteElement(note);
                    const x = startTime * 200;
                    const y = frequencyToY(frequency);
                    const width = duration * 200;
                    const height = 20;
                    noteRect.setSize({ width: width, height: height });
                    space.addChild(noteRect, { x: x, y: y });
                    return {
                        ...note,
                        id: parseInt(id),
                        element: noteRect,
                        getBoundingBox: () => noteRect.getBoundingBox()
                    };
                } else {
                    // Measure bar (we don't create visual elements for these here)
                    return note;
                }
            });
    
        updateTimingBoundaries();
        createMeasureBars();  // This creates the visual elements for measure bars
    
        // Reapply selections after recreating notes and measure bars
        selectedIds.forEach(id => {
            const newElement = document.querySelector(`.note-content[data-note-id="${id}"], .base-note-circle[data-note-id="${id}"], .measure-bar-triangle[data-note-id="${id}"]`);
            if (newElement) {
                newElement.classList.add('selected');
            }
        });
    }
    
    let audioContext = new (window.AudioContext || window.webkitAudioContext)();
    let generalVolumeGainNode = audioContext.createGain();
    let compressor = audioContext.createDynamicsCompressor();
    generalVolumeGainNode.connect(compressor);
    compressor.connect(audioContext.destination);
    
    function initAudioContext() {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }
    }
    
    document.addEventListener('DOMContentLoaded', initAudioContext);
    
    function playNote(note, startTime) {
        try {
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            oscillator.frequency.value = note.frequency.valueOf();
            oscillator.type = 'sine';
            gainNode.gain.value = 0;
            const duration = note.duration.valueOf();
            const attackTime = duration * ATTACK_TIME_RATIO;
            const decayTime = duration * DECAY_TIME_RATIO;
            const releaseTime = duration * RELEASE_TIME_RATIO;
            const sustainTime = duration - attackTime - decayTime - releaseTime;
            gainNode.gain.setValueAtTime(0, startTime);
            gainNode.gain.linearRampToValueAtTime(INITIAL_VOLUME, startTime + attackTime);
            gainNode.gain.linearRampToValueAtTime(INITIAL_VOLUME * SUSTAIN_LEVEL, startTime + attackTime + decayTime);
            gainNode.gain.setValueAtTime(INITIAL_VOLUME * SUSTAIN_LEVEL, startTime + attackTime + decayTime + sustainTime);
            gainNode.gain.linearRampToValueAtTime(0, startTime + duration);
            oscillator.connect(gainNode);
            gainNode.connect(generalVolumeGainNode);
            oscillator.start(startTime);
            oscillator.stop(startTime + duration);
            oscillators.push({ oscillator, gainNode });
            oscillator.onended = () => {
                const index = oscillators.findIndex(oscObj => oscObj.oscillator === oscillator);
                if (index !== -1) {
                    oscillators.splice(index, 1);
                }
            };
        } catch (e) {
            console.error('Error in playNote:', e);
        }
    }
    
    function play(fromTime = null) {
        if (fromTime === null) {
            fromTime = playheadTime;
        }
        if (fromTime >= getModuleEndTime()) {
            fromTime = 0;
        }
        const pp = document.querySelector('.pp');
        pp.classList.add('open');
        isPlaying = true;
        isPaused = false;
        if (audioContext.state === 'suspended') {
            audioContext.resume().then(() => {
                startPlayback(fromTime);
            });
        } else {
            startPlayback(fromTime);
        }
        isInitialClick = false;
    }
    
    function startPlayback(fromTime) {
        cleanupAudio();
        const startTime = audioContext.currentTime;
        currentTime = startTime - fromTime;
        playheadTime = fromTime;
        totalPausedTime = 0;
        isPaused = false;
        const evaluatedNotes = myModule.evaluateModule();
        const moduleEndTime = getModuleEndTime();
        const activeNotes = Object.keys(evaluatedNotes)
            .map(id => evaluatedNotes[id])
            .filter(note => {
                if (!note.startTime || !note.duration || !note.frequency) return false;
                const noteStart = note.startTime.valueOf();
                const noteEnd = noteStart + note.duration.valueOf();
                return noteEnd > fromTime && noteStart < moduleEndTime;
            });
        activeNotes.forEach(note => {
            const noteStart = note.startTime.valueOf();
            const noteEnd = noteStart + note.duration.valueOf();
            const adjustedStart = Math.max(0, noteStart - fromTime);
            const adjustedDuration = noteEnd - Math.max(noteStart, fromTime);
            try {
                playNote({
                    ...note,
                    startTime: new Fraction(adjustedStart),
                    duration: new Fraction(adjustedDuration)
                }, startTime + adjustedStart);
            } catch (e) {
                console.error('Failed to play note:', e);
            }
        });
    }
    
    function pause() {
        if (!isPlaying || isPaused) return;
        isPaused = true;
        isFadingOut = true;
        const currentPauseTime = audioContext.currentTime - currentTime;
        playheadTime = currentPauseTime + totalPausedTime;
        pausedAtTime = currentPauseTime;
        totalPausedTime += currentPauseTime;
        cleanupAudio();
        setTimeout(() => {
            isPlaying = false;
            isFadingOut = false;
        }, GENERAL_VOLUME_RAMP_TIME * 1000);
        const pp = document.querySelector('.pp');
        pp.classList.remove('open');
    }
    
    function stop(resetPlayhead = true) {
        if (!isPlaying && !isPaused && playheadTime === 0) return;
        if (resetPlayhead) {
            playheadTime = 0;
            totalPausedTime = 0;
        }
        isPlaying = false;
        isPaused = false;
        isFadingOut = false;
        const pp = document.querySelector('.pp');
        pp.classList.remove('open');
        cleanupAudio();
        updatePlayhead();
    }
    
    function setVolume(value) {
        if (isPlaying) {
            generalVolumeGainNode.gain.linearRampToValueAtTime(value, audioContext.currentTime + GENERAL_VOLUME_RAMP_TIME);
        } else {
            generalVolumeGainNode.gain.value = value;
        }
    }
    
    document.addEventListener('mousedown', (event) => {
        isDragging = false;
        dragStartX = event.clientX;
        dragStartY = event.clientY;
    });
    
    document.addEventListener('mousemove', (event) => {
        if (!isDragging) {
            const deltaX = Math.abs(event.clientX - dragStartX);
            const deltaY = Math.abs(event.clientY - dragStartY);
            if (deltaX > DRAG_THRESHOLD || deltaY > DRAG_THRESHOLD) {
                isDragging = true;
            }
        }
    });
    
    document.addEventListener('mouseup', (event) => {
        if (!isDragging) {
            if (!noteWidget.contains(event.target) && 
                !event.target.closest('.note-rect') && 
                !event.target.closest('#baseNoteCircle') &&
                !event.target.closest('.measure-bar-triangle') &&
                !event.target.closest('.delete-confirm-overlay')) {
                clearSelection();
            }
            if (!widget.contains(event.target) && !dropdownButton.contains(event.target)) {
                plusminus.classList.remove('open');
                widget.classList.remove('open');
            }
        }
        isDragging = false;
    });
    
    const dropdownButton = document.querySelector('.dropdown-button');
    const plusminus = document.querySelector('.plusminus');
    const widget = document.getElementById('general-widget');
    
    dropdownButton.addEventListener('click', (event) => {
        event.stopPropagation();
        plusminus.classList.toggle('open');
        widget.classList.toggle('open');
    });
    
    document.getElementById('volumeSlider').addEventListener('touchstart', function() {
        this.classList.add('active');
    });
    
    document.getElementById('volumeSlider').addEventListener('touchend', function() {
        this.classList.remove('active');
    });
    
    const sliders = document.querySelectorAll('.slider-container input[type="range"]');
    sliders.forEach(slider => {
        const valueDisplay = slider.parentElement.querySelector('span');
        slider.addEventListener('input', (e) => {
            valueDisplay.textContent = e.target.value;
        });
    });
    
    document.getElementById('trackingToggle').addEventListener('change', (event) => {
        isTrackingEnabled = event.target.checked;
        if (isTrackingEnabled) {
            const x = playheadTime * 200;
            const viewCenter = viewport.atCenter();
            const targetPoint = new tapspace.geometry.Point(space, { 
                x: x, 
                y: viewCenter.transitRaw(space).y, 
                z: 0 
            });
            viewport.translateTo(targetPoint);
        }
        updateZoomableBehavior();
    });
    
    document.getElementById('playPauseBtn').addEventListener('click', () => {
        if (isPlaying) {
            pause();
        } else {
            play(playheadTime);
        }
    });
    
    document.getElementById('stopButton').addEventListener('click', () => {
        stop(true);
    });
    
    document.getElementById('volumeSlider').addEventListener('input', (event) => {
        setVolume(event.target.value);
    });
    
    const loadModuleInput = document.getElementById('loadModuleInput');
    const loadModuleBtn = document.getElementById('loadModuleBtn');
    if (loadModuleBtn && loadModuleInput) {
        loadModuleBtn.addEventListener('click', () => {
            loadModuleInput.click();
        });
        loadModuleInput.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (file) {
                loadModule(file);
            }
            event.target.value = '';
        });
    } else {
        console.error('Load Module button or input not found!');
    }

    const reorderModuleBtn = document.getElementById('reorderModuleBtn');
    if (reorderModuleBtn) {
        reorderModuleBtn.addEventListener('click', function() {
            reorderCurrentModule();
        });
    } else {
        console.error('Reorder Module button not found!');
    }
    
    function reorderCurrentModule() {
        myModule.exportOrderedModule().then(orderedJSONString => {
            const data = JSON.parse(orderedJSONString);
            if (isPlaying || isPaused) {
                stop(true);
            }
            cleanupCurrentModule();
            Module.loadFromJSON(data).then(newModule => {
                myModule = newModule;
                initializeModule();
            }).catch(error => {
                console.error('Error reordering module:', error);
                const errorMsg = document.createElement('div');
                errorMsg.className = 'error-message';
                errorMsg.textContent = `Error reordering module: ${error.message}`;
                document.body.appendChild(errorMsg);
                setTimeout(() => errorMsg.remove(), 3000);
            });
        }).catch(error => {
            console.error('Error exporting ordered module:', error);
        });
    }
    
    function loadModule(file) {
        try {
            file.text().then((fileContent) => {
                const moduleData = JSON.parse(fileContent);
                if (isPlaying || isPaused) {
                    stop(true);
                }
                cleanupCurrentModule();
                Module.loadFromJSON(moduleData).then(newModule => {
                    myModule = newModule;
                    initializeModule();
                }).catch((error) => {
                    console.error('Error loading module:', error);
                    const errorMsg = document.createElement('div');
                    errorMsg.className = 'error-message';
                    errorMsg.textContent = `Error loading module: ${error.message}`;
                    document.body.appendChild(errorMsg);
                    setTimeout(() => errorMsg.remove(), 3000);
                });
            });
        } catch (error) {
            console.error('Error reading module file:', error);
        }
    }
    
    function cleanupCurrentModule() {
        cleanupAudio();
        const currentNotes = space.getChildren();
        currentNotes.forEach(note => {
            note.remove();
            space.removeChild(note);
        });
        measureBars.forEach(bar => bar.remove());
        measureBars = [];
        playheadTime = 0;
        totalPausedTime = 0;
        newNotes = [];
    }
    
    function initializeModule() {
        evaluatedNotes = myModule.evaluateModule();
        newNotes = Object.keys(evaluatedNotes)
            .map(id => evaluatedNotes[id])
            .filter(note => note.startTime && note.duration && note.frequency);
        baseNoteFreq = myModule.baseNote.getVariable('frequency').valueOf();
        baseNoteY = frequencyToY(baseNoteFreq);
        baseNoteDisplay = createBaseNoteDisplay();
        centerPoint = space.at(0, baseNoteY);
        viewport.translateTo(centerPoint);
        updateTimingBoundaries();
        createMeasureBars();
        updateVisualNotes(evaluatedNotes);
        updatePlayhead();
    }
    
    function createModuleJSON() {
        const moduleData = {
            baseNote: {
                frequency: myModule.baseNote.variables.frequencyString || `new Fraction(${myModule.baseNote.variables.frequency.n}, ${myModule.baseNote.variables.frequency.d})`,
                startTime: myModule.baseNote.variables.startTimeString || `new Fraction(${myModule.baseNote.variables.startTime.n}, ${myModule.baseNote.variables.startTime.d})`,
                tempo: myModule.baseNote.variables.tempoString || `new Fraction(${myModule.baseNote.variables.tempo.n}, ${myModule.baseNote.variables.tempo.d})`,
                beatsPerMeasure: myModule.baseNote.variables.beatsPerMeasureString || `new Fraction(${myModule.baseNote.variables.beatsPerMeasure.n}, ${myModule.baseNote.variables.beatsPerMeasure.d})`
            },
            notes: []
        };
    
        Object.entries(myModule.notes).forEach(([id, note]) => {
            if (id !== '0') {
                const noteData = {
                    id: note.id
                };
                Object.entries(note.variables).forEach(([key, value]) => {
                    if (!key.endsWith('String')) {
                        if (typeof value === 'function') {
                            noteData[key] = note.variables[key + 'String'] || value.toString();
                        } else if (value instanceof Fraction) {
                            noteData[key] = `new Fraction(${value.n}, ${value.d})`;
                        } else {
                            noteData[key] = value;
                        }
                    }
                });
                moduleData.notes.push(noteData);
            }
        });
        return moduleData;
    }
    
    function saveModule() {
        myModule.exportOrderedModule().then(orderedJSONString => {
            const blob = new Blob([orderedJSONString], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'module.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);
        }).catch(error => {
            console.error('Error exporting module:', error);
            const errorMsg = document.createElement('div');
            errorMsg.className = 'error-message';
            errorMsg.textContent = `Error exporting module: ${error.message}`;
            document.body.appendChild(errorMsg);
            setTimeout(() => errorMsg.remove(), 3000);
        });
    }
    
    function validateExpression(moduleInstance, noteId, expression, variableType) {
        //console.log(`Validating expression for Note ${noteId}: ${expression}`);
        
        if (!expression || expression.trim() === '') {
            //console.log(`Empty or undefined expression detected for Note ${noteId}`);
            throw new Error('Expression cannot be empty or undefined');
        }
    
        if (expression.includes(`getNoteById(${noteId})`)) {
            //console.log(`Direct self-reference detected in Note ${noteId}`);
            throw new Error('Expression cannot reference itself directly');
        }
        
        if (detectCircularDependency(moduleInstance, noteId, expression, variableType)) {
            //console.log(`Circular dependency detected for Note ${noteId}`);
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
    
    function detectCircularDependency(moduleInstance, noteId, expression, variableType) {
        //console.log(`Checking for circular dependency for Note ${noteId}, expression: ${expression}`);
    
        function findReferences(expr) {
            const regex = /getNoteById\((\d+)\)/g;
            const references = new Set();
            let match;
            while ((match = regex.exec(expr)) !== null) {
                references.add(parseInt(match[1]));
            }
            //console.log(`References found in expression: ${Array.from(references)}`);
            return references;
        }
    
        function getExpressionString(note, varName) {
            if (note.variables[varName + 'String']) {
                return note.variables[varName + 'String'];
            } else if (typeof note.variables[varName] === 'function') {
                return note.variables[varName].toString();
            }
            return '';
        }
    
        function checkReferences(currentId, originalId, visited = new Set()) {
            //console.log(`Checking references for Note ${currentId} (Original: ${originalId})`);
            
            if (visited.has(currentId)) {
                //console.log(`Note ${currentId} already visited, skipping`);
                return false;
            }
            visited.add(currentId);
    
            const currentNote = moduleInstance.getNoteById(currentId);
            if (!currentNote) {
                //console.log(`Note ${currentId} not found in module`);
                return false;
            }
    
            for (const varName in currentNote.variables) {
                //console.log(`Checking variable ${varName} of Note ${currentId}`);
                let exprStr;
                try {
                    exprStr = getExpressionString(currentNote, varName);
                } catch (error) {
                    //console.log(`Error getting expression string for ${varName} of Note ${currentId}:`, error);
                    continue;
                }
                //console.log(`Expression string: ${exprStr}`);
                const references = findReferences(exprStr);
    
                if (references.has(originalId)) {
                    //console.log(`Circular dependency detected: Note ${currentId} references original Note ${originalId}`);
                    return true;
                }
    
                for (const refId of references) {
                    //console.log(`Recursively checking reference ${refId} from Note ${currentId}`);
                    if (checkReferences(refId, originalId, new Set(visited))) {
                        //console.log(`Circular dependency detected in nested reference: ${refId} -> ${originalId}`);
                        return true;
                    }
                }
            }
    
            //console.log(`No circular dependency found for Note ${currentId}`);
            return false;
        }
    
        const newReferences = findReferences(expression);
        for (const refId of newReferences) {
            //console.log(`Checking reference ${refId} from new expression`);
            if (checkReferences(refId, noteId)) {
                //console.log(`Circular dependency detected: ${refId} -> ${noteId}`);
                return true;
            }
        }
    
        //console.log(`No circular dependency detected for Note ${noteId}`);
        return false;
    }
    
    const TOP_HEADER_HEIGHT = 50;
    const MIN_BUFFER = 20;
    let widgetInitiallyOpened = false;
    
    function updateNoteWidgetHeight() {
        const widget = document.getElementById('note-widget');
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
    
    function handleWindowResize() {
        const widget = document.getElementById('note-widget');
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
      
    updateNoteWidgetHeight();
    window.addEventListener('resize', handleWindowResize);
    
    function addDraggableNoteWidget() {
    const widget = document.getElementById('note-widget');
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
    
    addDraggableNoteWidget();

    // Second resizeable Top Bar functionality

    const secondTopBar = document.querySelector('.second-top-bar');
    const iconsWrapper = document.querySelector('.icons-wrapper');
    const pullTab = document.querySelector('.pull-tab');
    let isDragging2 = false;
    let startY;
    let startHeight;

    pullTab.addEventListener('mousedown', initResize);
    document.addEventListener('mousemove', resize);
    document.addEventListener('mouseup', stopResize);

    pullTab.addEventListener('touchstart', initResize, { passive: false });
    document.addEventListener('touchmove', resize, { passive: false });
    document.addEventListener('touchend', stopResize);

    function initResize(e) {
        isDragging2 = true;
        startY = e.clientY || e.touches[0].clientY;
        startHeight = parseInt(document.defaultView.getComputedStyle(secondTopBar).height, 10);
        e.preventDefault();
    }

    function resize(e) {
        if (!isDragging2) return;
        const clientY = e.clientY || e.touches[0].clientY;
        const deltaY = clientY - startY;
        const newHeight = Math.max(0, Math.min(startHeight + deltaY, getMaxHeight()));
        secondTopBar.style.height = newHeight + 'px';
        e.preventDefault();
    }

    function stopResize() {
        isDragging2 = false;
    }

    function getMaxHeight() {
        return iconsWrapper.scrollHeight;
    }

    secondTopBar.style.height = '50px';
});