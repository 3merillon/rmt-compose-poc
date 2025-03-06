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
  const INITIAL_VOLUME = 0.2;
  const ATTACK_TIME_RATIO = 0.1;
  const DECAY_TIME_RATIO = 0.1;
  const SUSTAIN_LEVEL = 0.7;
  const RELEASE_TIME_RATIO = 0.2;
  const GENERAL_VOLUME_RAMP_TIME = 0.2;
  const OSCILLATOR_POOL_SIZE = 64; // Maximum number of oscillators to keep in the pool
  let oscillatorPool = [];
  let gainNodePool = [];
  let activeOscillators = new Map(); // Map to track active oscillators by ID
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

  // Expose necessary functions to the modals module
  if (window.modals) {
    window.modals.setExternalFunctions({
      updateVisualNotes: updateVisualNotes,
      updateBaseNoteFraction: updateBaseNoteFraction,
      updateBaseNotePosition: updateBaseNotePosition,
      hasMeasurePoints: hasMeasurePoints,
      getLastMeasureId: getLastMeasureId,
      updateTimingBoundaries: updateTimingBoundaries,
      createMeasureBars: createMeasureBars,
      deleteNoteAndDependencies: deleteNoteAndDependencies,
      deleteNoteKeepDependencies: deleteNoteKeepDependencies,
      cleanSlate: cleanSlate
    });
  }

  // Cache DOM elements
  const domCache = {
      resetViewBtn: document.getElementById('resetViewBtn'),
      noteWidget: document.getElementById('note-widget'),
      closeWidgetBtn: document.querySelector('.note-widget-close'),
      saveModuleBtn: document.getElementById('saveModuleBtn'),
      widgetContent: document.querySelector('.note-widget-content'),
      widgetTitle: document.getElementById('note-widget-title'),
      measureBarsContainer: document.getElementById('measureBarsContainer'),
      playheadContainer: document.getElementById('playheadContainer'),
      trianglesContainer: document.getElementById('measureBarTrianglesContainer'),
      volumeSlider: document.getElementById('volumeSlider'),
      loadModuleInput: document.getElementById('loadModuleInput'),
      loadModuleBtn: document.getElementById('loadModuleBtn'),
      reorderModuleBtn: document.getElementById('reorderModuleBtn'),
      trackingToggle: document.getElementById('trackingToggle'),
      playPauseBtn: document.getElementById('playPauseBtn'),
      stopButton: document.getElementById('stopButton'),
      ppElement: document.querySelector('.pp'),
      dropdownButton: document.querySelector('.dropdown-button'),
      plusminus: document.querySelector('.plusminus'),
      generalWidget: document.getElementById('general-widget')
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

  function debounce(func, wait) {
    let timeout;
    return function(...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), wait);
    };
  }

  // Prevent mobile performance throttling on browser that support the Wake Lock API
  let wakeLock = null;

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
        //console.log('Wake Lock is active');
        wakeLock.addEventListener('release', () => {
          console.log('Wake Lock was released');
        });
      } else {
        console.warn('Wake Lock API not available in this browser.');
      }
    } catch (err) {
      console.error('Could not obtain wake lock:', err);
    }
  }

  // Listen for visibility change events to re‑request or release the wake lock
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
      // When the page becomes visible, try to re‑acquire the wake lock.
      await requestWakeLock();
    } else {
      // Optionally release the wake lock when not visible
      if (wakeLock !== null) {
        await wakeLock.release();
        wakeLock = null;
        console.log('Wake Lock released due to page visibility change');
      }
    }
  });

  // Request the wake lock
  requestWakeLock();

  // Initialize the resetViewBtn inner structure
  if (domCache.resetViewBtn) {
    domCache.resetViewBtn.innerHTML = `
      <div class="center-circle"></div>
      <div class="arrow top"></div>
      <div class="arrow bottom"></div>
      <div class="arrow left"></div>
      <div class="arrow right"></div>
    `;
  }

  /* ---------- DELETE DEPENDENCIES FUNCTIONALITY ---------- */

  /* Show a confirmation modal for deletion */
  function showDeleteConfirmation(noteId) {
    window.modals.showDeleteConfirmation(noteId);
  }

  /* Delete the target note and all of its dependent notes */
  function deleteNoteAndDependencies(noteId) {
    const dependents = myModule.getDependentNotes(noteId);
    const idsToDelete = new Set([noteId, ...dependents]);
    
    idsToDelete.forEach(id => {
        if (id !== 0) {
            delete myModule.notes[id];
            delete myModule._evaluationCache[id]; // Clean up the cache
        }
    });
    
    // Mark the parent notes as dirty since their dependents changed
    const directDeps = myModule.getDirectDependencies(noteId);
    directDeps.forEach(depId => {
        myModule.markNoteDirty(depId);
    });

    evaluatedNotes = myModule.evaluateModule();
    updateVisualNotes(evaluatedNotes);
    createMeasureBars();
    clearSelection();
    invalidateModuleEndTimeCache();
  }

  function showCleanSlateConfirmation() {
    window.modals.showCleanSlateConfirmation();
  }

  function cleanSlate() {
    // Keep only the base note (id 0)
    Object.keys(myModule.notes).forEach(id => {
        if (id !== '0') {
            delete myModule.notes[id];
        }
    });
    
    // Reset the nextId to 1
    myModule.nextId = 1;
    
    // Reset the evaluation cache
    myModule._evaluationCache = {};
    myModule._dirtyNotes.clear();
    myModule.markNoteDirty(0); // Mark the base note as dirty
    
    // Re-evaluate and update the visual representation
    evaluatedNotes = myModule.evaluateModule();
    updateVisualNotes(evaluatedNotes);
    createMeasureBars();
    clearSelection();
    
    // Close the note widget
    domCache.noteWidget.classList.remove('visible');
  }

  /* ---------- KEEP DEPENDENCIES FUNCTIONALITY ---------- */

  /* Show confirmation modal for "Keep Dependencies" deletion */
  function showDeleteConfirmationKeepDependencies(noteId) {
    window.modals.showDeleteConfirmationKeepDependencies(noteId);
  }

  /* ---------- updateDependentRawExpressions ----------
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

  /* ---------- deleteNoteKeepDependencies ----------
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
        delete myModule._evaluationCache[noteId]; // Clean up the cache
        
        // Mark all notes that depended on this note as dirty
        const dependents = myModule.getDependentNotes(noteId);
        dependents.forEach(depId => {
            myModule.markNoteDirty(depId);
        });
      }
      
      evaluatedNotes = myModule.evaluateModule();
      updateVisualNotes(evaluatedNotes);
      createMeasureBars();
      clearSelection();
      invalidateModuleEndTimeCache();
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
    
  // Memoization for module end time
  let memoizedModuleEndTime = null;
  let moduleLastModifiedTime = 0;

  function getModuleEndTime() {
      const currentModifiedTime = getCurrentModifiedTime();
      
      if (memoizedModuleEndTime !== null && currentModifiedTime === moduleLastModifiedTime) {
          //console.log('Returning memoized module end time');
          return memoizedModuleEndTime;
      }
  
      //console.log('Calculating module end time');
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
  
      memoizedModuleEndTime = Math.max(measureEnd, lastNoteEnd);
      moduleLastModifiedTime = currentModifiedTime;
      return memoizedModuleEndTime;
  }

  // Helper function to get the current modified time of the module
  function getCurrentModifiedTime() {
      return Object.values(myModule.notes).reduce((maxTime, note) => {
        const noteTime = note.lastModifiedTime || 0;
        return Math.max(maxTime, noteTime);
      }, 0);
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

  let currentSelectedNote = null;

  if (domCache.saveModuleBtn) {
      domCache.saveModuleBtn.addEventListener('click', saveModule);
  } else {
      console.error('Save Module button not found!');
  }

  if (domCache.resetViewBtn) {
    domCache.resetViewBtn.addEventListener('click', () => {
      const baseNoteFreq = myModule.baseNote.getVariable('frequency').valueOf();
      const baseNoteY = frequencyToY(baseNoteFreq);
      const origin = space.at(0, baseNoteY);
      // Reset view: translate the viewport to "origin".
      viewport.translateTo(origin);
    });
  }

  /* ----------------------- IMPORT MODULE FUNCTION ----------------------- */
      /* ---------- In importModuleAtTarget (ensure deletion is handled separately) ----------
  For dropped modules, we want to rewrite any reference to the base note (id 0)
  to leave targetNote references intact (so that imported expressions remain chainable).
  Deletion will later remove any targetNote references.
  (No changes shown here; ensure that your importModuleAtTarget continues to replace base note references properly.)
  */
  async function importModuleAtTarget(targetNote, moduleData) {
    // If playback is ongoing, enforce a pause
    if (isPlaying) {
        pause();
    }

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
            // For a drop target that is not the base note, we want the imported module's base note references
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
            impNote.module = myModule; // Set the module reference
            myModule.notes[impNote.id] = impNote;
        }
    
        // Clear all caches in the module
        myModule._evaluationCache = {};
        myModule._lastEvaluationTime = 0;
        myModule._dependenciesCache.clear();
        myModule._dependentsCache.clear();
        
        // Mark all notes as dirty to force complete reevaluation
        for (const id in myModule.notes) {
            myModule.markNoteDirty(Number(id));
        }
        
        // Invalidate module end time cache
        invalidateModuleEndTimeCache();
        
        // Invalidate dependency graph cache
        if (window.modals && window.modals.invalidateDependencyGraphCache) {
            window.modals.invalidateDependencyGraphCache();
        }
        
        // IMPORTANT: Re-evaluate all notes and update the visual representation
        evaluatedNotes = myModule.evaluateModule();
        updateVisualNotes(evaluatedNotes);
        createMeasureBars();
        
        console.log("Module import complete with full cache reset");
        
    } catch (error) {
        console.error("Error importing module at target note:", error);
    }
  }
  window.importModuleAtTarget = importModuleAtTarget;
  /* ----------------------- END IMPORT MODULE FUNCTION ----------------------- */

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
  // visited is used to avoid cycles.
  function recompileNoteAndDependents(noteId, visited = new Set()) {
    if (visited.has(noteId)) return;
    visited.add(noteId);
    const note = myModule.getNoteById(noteId);
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
            return newFunc(myModule, Fraction);
          });
        } catch (err) {
          console.error("Error recompiling note", noteId, "variable", baseKey, ":", err);
        }
      }
    });
    // Now recompile all dependent notes
    const dependents = myModule.getDependentNotes(noteId);
    dependents.forEach(depId => {
      recompileNoteAndDependents(depId, visited);
    });
  }

    // showNoteVariables (main loop).
    function showNoteVariables(note, clickedElement, measureId = null) {
        window.modals.showNoteVariables(note, clickedElement, measureId);
    }
    
    function clearSelection() {
        window.modals.clearSelection();
    }
    
    domCache.closeWidgetBtn.addEventListener('click', () => {
        clearSelection();
    });
    
    function addNoteClickHandler(noteElement, note) {
      const noteRect = noteElement.element.querySelector('.note-rect');
      const noteContent = noteElement.element.querySelector('.note-content');
      if (noteRect && noteContent) {
          const debouncedShowNoteVariables = debounce((note, noteContent) => {
              currentSelectedNote = note;
              showNoteVariables(note, noteContent);
          }, 50); // 50ms debounce time
          
          noteRect.addEventListener('click', (event) => {
              event.stopPropagation();
              debouncedShowNoteVariables(note, noteContent);
          });
      }
    }
    
    function setupBaseNoteClickHandler() {
        const baseNoteCircle = document.getElementById('baseNoteCircle');
        const baseNoteElement = baseNoteCircle?.querySelector('.base-note-circle');
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
      
        // --- Dropping a module on the base note ---
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
        // --- Drop functionality addition ---
      
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
        
        // Cache DOM queries
        const fractionElements = document.querySelector('.base-note-fraction');
        if (fractionElements) {
            const numeratorDisplay = fractionElements.querySelector('.fraction-numerator');
            const denominatorDisplay = fractionElements.querySelector('.fraction-denominator');
            
            if (numeratorDisplay && denominatorDisplay) {
                numeratorDisplay.textContent = numerator;
                denominatorDisplay.textContent = denominator;
            }
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
      // Clear all scheduled timeouts
      scheduledTimeouts.forEach(timeout => clearTimeout(timeout));
      scheduledTimeouts = [];
      
      // Stop and disconnect all active oscillators
      for (const [id, oscObj] of activeOscillators.entries()) {
          try {
              // Cancel any scheduled gain changes
              oscObj.gainNode.gain.cancelScheduledValues(audioContext.currentTime);
              oscObj.gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.1);
              
              // Only try to stop if it was started but not yet stopped
              if (oscObj.started && !oscObj.stopped) {
                  oscObj.stopped = true;
                  try {
                      oscObj.oscillator.stop();
                  } catch (e) {
                      console.log('Oscillator already stopped or never started');
                  }
              }
              
              // Disconnect after a short delay to allow the gain ramp to complete
              setTimeout(() => {
                  try {
                      oscObj.oscillator.disconnect();
                      oscObj.gainNode.disconnect();
                  } catch (e) {
                      console.log('Error disconnecting oscillator:', e);
                  }
              }, 100);
          } catch (e) {
              console.log('Oscillator cleanup error:', e);
          }
      }
      
      // Clear the active oscillators map
      activeOscillators.clear();
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
   Returns the fraction string that represents the note's frequency relative to the base note.
   It first tries to extract a raw fraction from note.variables.frequencyString.
   If the extracted string does not include a "/", it appends "/1".
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

// Helper function: getMovedNotes
// Given the dragged note, a candidate new start time (newDraggedStart) as a Fraction,
// and the original dragged start time (also Fraction),
// temporarily override the dragged note's startTime and return the list of dependent notes
// (transitively) whose evaluated startTime changes.
function getMovedNotes(draggedNote, newDraggedStart, originalDraggedStart) {
  // Get the list of dependent note IDs (do not include the dragged note itself).
  const affectedIds = myModule.getDependentNotes(draggedNote.id);
  const originalValues = {};
  affectedIds.forEach(id => {
    const depNote = myModule.getNoteById(id);
    if (depNote && typeof depNote.getVariable === 'function') {
      originalValues[id] = new Fraction(depNote.getVariable('startTime').valueOf());
    }
  });
  // Temporarily override the dragged note's startTime to newDraggedStart.
  const savedStartFunc = draggedNote.variables.startTime;
  draggedNote.variables.startTime = () => newDraggedStart;
  
  const moved = [];
  const tol = new Fraction(1, 10000); // tolerance = 1/10000 beats
  affectedIds.forEach(id => {
    const depNote = myModule.getNoteById(id);
    if (depNote && typeof depNote.getVariable === 'function') {
      let newVal = new Fraction(depNote.getVariable('startTime').valueOf());
      // If the difference is significant, add it.
      if (newVal.sub(originalValues[id]).abs().compare(tol) > 0) {
        moved.push({ note: depNote, newStart: newVal });
      }
    }
  });
  
  // Restore the dragged note's original startTime function.
  draggedNote.variables.startTime = savedStartFunc;
  return moved;
}

/* ---------- CreateNoteElement ---------- */
function createNoteElement(note, index) {
  // Calculate fraction string and extract numerator/denom for display.
  const fractionStr = getFrequencyRatio(note);
  const parts = fractionStr.split('/');
  const numerator = parts[0] || "undefined";
  const denominator = parts[1] || "undefined";
  const noteColor = getColorForNote(note);

  // Measure text widths for proper layout.
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

  // Create the note element using tapspace.
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

  // Ensure the note element carries its data-note-id.
  noteRect.element.setAttribute('data-note-id', note.id);

  // Setup hover effects.
  const noteContentElem = noteRect.element.querySelector('.note-content');
  noteRect.element.addEventListener('mouseenter', () => {
    noteContentElem.style.borderColor = 'white';
    noteContentElem.style.boxShadow = '0 0 5px #ffa800, 0 0 10px #ffa800, 0 0 15px #ffa800';
  });
  noteRect.element.addEventListener('mouseleave', () => {
    noteContentElem.style.borderColor = '#636363';
    noteContentElem.style.boxShadow = 'none';
  });

  // Preserve native click behavior (for stack-click).
  addNoteClickHandler(noteRect, note);

  // Desktop drag/drop for module import.
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

  // --- Draggable Note Functionality for Timeline Movement ---
  let dragData = {
    startX: 0,
    hasDragged: false,
    hasCaptured: false,
    originalBeatOffset: 0,
    originalStartTime: 0,
    originalRaw: "",
    reference: "module.baseNote",
    pointerIsDown: false  // Add this flag to track if pointer is down
  };

  // On pointerdown, capture baseline data.
  noteRect.element.addEventListener('pointerdown', (e) => {
    dragData.startX = e.clientX;
    dragData.hasDragged = false;
    dragData.hasCaptured = false;
    dragData.pointerIsDown = true;  // Set flag when pointer is down
    
    // Store original startTime as Fraction.
    let origStart = new Fraction(note.getVariable('startTime').valueOf());
    dragData.originalStartTime = origStart;
    dragData.originalRaw = note.variables.startTimeString || "";
    
    // Determine the dependency via the raw expression.
    // Look for a pattern "module.getNoteById(<id>)".
    let referenceMatch = /module\.getNoteById\(\s*(\d+)\s*\)/.exec(dragData.originalRaw);
    if (referenceMatch) {
      dragData.reference = "module.getNoteById(" + referenceMatch[1] + ")";
    } else {
      dragData.reference = "module.baseNote";
    }
    
    // Set the dependency note: if dragData.reference is not the base note, then use the parsed id.
    let depNote;
    if (dragData.reference === "module.baseNote") {
      depNote = myModule.baseNote;
    } else {
      let m = /module\.getNoteById\(\s*(\d+)\s*\)/.exec(dragData.reference);
      depNote = m ? myModule.getNoteById(m[1]) : myModule.baseNote;
    }
    // Store the dependency's startTime as a Fraction.
    dragData.refStart = new Fraction(depNote.getVariable('startTime').valueOf());
    
    // Get base tempo as Fraction and compute beatLength.
    let baseTempo = new Fraction(myModule.baseNote.getVariable('tempo').valueOf());
    let beatLength = new Fraction(60).div(baseTempo);
    
    // Compute the original beat offset as (origStart - refStart)/beatLength.
    dragData.originalBeatOffsetFraction = origStart.sub(dragData.refStart).div(beatLength);
    
    // (Optionally, for backward compatibility, also store it in originalBeatOffset.)
    dragData.originalBeatOffset = dragData.originalBeatOffsetFraction;
    
    // Create and/or clear the overlay container.
    let overlayContainer = document.getElementById('drag-overlay-container');
    if (!overlayContainer) {
      overlayContainer = document.createElement('div');
      overlayContainer.id = 'drag-overlay-container';
      overlayContainer.style.position = 'fixed';
      overlayContainer.style.top = '0';
      overlayContainer.style.left = '0';
      overlayContainer.style.width = '100%';
      overlayContainer.style.height = '100%';
      overlayContainer.style.pointerEvents = 'none';
      overlayContainer.style.zIndex = '10000';
      document.body.appendChild(overlayContainer);
    } else {
      overlayContainer.innerHTML = '';
    }
    
    // Precompute baseline dependencies using the unmodified (original) start.
    dragData.baselineDependencies = getMovedNotes(note, origStart, origStart);
  });

  noteRect.element.addEventListener('pointermove', (e) => {
    // Only process move events if pointer is down
    if (!dragData.pointerIsDown) return;
    
    // Guard: ensure our Fraction field is set.
    if (!dragData.originalBeatOffsetFraction) { return; }
    
    const deltaX = e.clientX - dragData.startX;
    if (!dragData.hasDragged && Math.abs(deltaX) > 5) {
        dragData.hasDragged = true;
        noteRect.element.setPointerCapture(e.pointerId);
        dragData.hasCaptured = true;
        
        // Only pause playback when actually dragging (not just hovering)
        if (isPlaying) {
            pause();
        }
    }
    
    if (dragData.hasDragged) {
        // Get the current viewport scale by measuring a known distance in space
        const spacePoint1 = space.at(0, 0);
        const spacePoint2 = space.at(100, 0);
        
        // Project these points to viewport coordinates
        const viewportPoint1 = spacePoint1.transitRaw(viewport);
        const viewportPoint2 = spacePoint2.transitRaw(viewport);
        
        // Calculate the scale factor: how many viewport pixels per 100 space units
        const viewportDistance = Math.sqrt(
            Math.pow(viewportPoint2.x - viewportPoint1.x, 2) + 
            Math.pow(viewportPoint2.y - viewportPoint1.y, 2)
        );
        const scale = viewportDistance / 100;
        
        // Adjust deltaX based on the current scale
        let adjustedDeltaX = deltaX / scale;
        
        // Convert the adjusted pixel delta to time units
        // Use a safer approach to create fractions from potentially non-integer values
        const numerator = Math.round(adjustedDeltaX * 1000); // Scale up and round to avoid floating point issues
        const denominator = 200 * 1000; // Scale up the denominator by the same factor
        let deltaTime = new Fraction(numerator, denominator);
        
        let baseTempo = new Fraction(myModule.baseNote.getVariable('tempo').valueOf());
        let beatLength = new Fraction(60).div(baseTempo);
        let step = beatLength.div(new Fraction(4));
        let ratio = deltaTime.div(step);
        let nearest = new Fraction(Math.round(Number(ratio)));
        let snappedDelta = step.mul(nearest);
        
        // New beat offset = originalBeatOffsetFraction + snappedDelta/beatLength.
        let newBeatOffsetFraction = dragData.originalBeatOffsetFraction.add(snappedDelta.div(beatLength));
        
        // New start time = refStart + (newBeatOffset * beatLength).
        let newStartTimeFraction = dragData.refStart.add(newBeatOffsetFraction.mul(beatLength));
        
        // CLAMPING: Use dragData.reference to get the dependency's startTime.
        let depNote;
        if (dragData.reference === "module.baseNote") {
            depNote = myModule.baseNote;
        } else {
            let m = /module\.getNoteById\(\s*(\d+)\s*\)/.exec(dragData.reference);
            depNote = m ? myModule.getNoteById(m[1]) : myModule.baseNote;
        }
        let depStartFraction = new Fraction(depNote.getVariable('startTime').valueOf());
        if (newStartTimeFraction.compare(depStartFraction) < 0) {
            // If new start is less than dependency start, clamp:
            newStartTimeFraction = depStartFraction;
            newBeatOffsetFraction = newStartTimeFraction.sub(dragData.refStart).div(beatLength);
        }
        
        // For overlay drawing, use the numeric value.
        let newStartTimeNum = Number(newStartTimeFraction.valueOf());
        
        // Calculate the position for the overlay in the same way as the original code
        const xCoord = newStartTimeNum * 200;
        const point = new tapspace.geometry.Point(space, { x: xCoord, y: 0 });
        const screenPos = point.transitRaw(viewport);
        
        // Update the overlay using the original approach
        updateDragOverlay(note, newStartTimeNum, null, 'dragged');
        
        // Update dependency overlays using our helper.
        let movedNotes = getMovedNotes(note, newStartTimeFraction, dragData.originalStartTime);
        if (movedNotes.length === 0 && newBeatOffsetFraction.equals(dragData.originalBeatOffsetFraction)) {
            movedNotes = dragData.baselineDependencies || [];
        }
        
        let overlayContainer = document.getElementById('drag-overlay-container');
        if (overlayContainer) {
            [...overlayContainer.children].forEach(overlayElem => {
                if (overlayElem.id && overlayElem.id.indexOf("drag-overlay-dep-") === 0) {
                    const depId = parseInt(overlayElem.id.replace("drag-overlay-dep-", ""), 10);
                    if (!movedNotes.some(item => item.note.id === depId)) {
                        overlayElem.remove();
                    }
                }
            });
        }
        movedNotes.forEach(item => {
            updateDragOverlay(item.note, Number(item.newStart.valueOf()), item.note.id, 'dependency');
        });
    }
  });

  noteRect.element.addEventListener('pointerup', (e) => {
    // Reset pointer down flag
    dragData.pointerIsDown = false;
    
    const overlayContainer = document.getElementById('drag-overlay-container');
    if (overlayContainer && overlayContainer.parentNode) {
        overlayContainer.parentNode.removeChild(overlayContainer);
    }
  
    if (dragData.hasDragged) {
        const deltaX = e.clientX - dragData.startX;
        
        // Get the current viewport scale by measuring a known distance in space
        const spacePoint1 = space.at(0, 0);
        const spacePoint2 = space.at(100, 0);
        
        // Project these points to viewport coordinates
        const viewportPoint1 = spacePoint1.transitRaw(viewport);
        const viewportPoint2 = spacePoint2.transitRaw(viewport);
        
        // Calculate the scale factor: how many viewport pixels per 100 space units
        const viewportDistance = Math.sqrt(
            Math.pow(viewportPoint2.x - viewportPoint1.x, 2) + 
            Math.pow(viewportPoint2.y - viewportPoint1.y, 2)
        );
        const scale = viewportDistance / 100;
        
        // Adjust deltaX based on the current scale
        let adjustedDeltaX = deltaX / scale;
        
        // Convert the adjusted pixel delta to time units
        // Use a safer approach to create fractions from potentially non-integer values
        const tempNumerator = Math.round(adjustedDeltaX * 1000); // Scale up and round to avoid floating point issues
        const tempDenominator = 200 * 1000; // Scale up the denominator by the same factor
        let deltaTime = new Fraction(tempNumerator, tempDenominator);
        
        const baseTempo = myModule.baseNote.getVariable('tempo').valueOf();
        const beatLength = 60 / baseTempo;
        const step = beatLength / 4; // sixteenth-note step.
        
        let snappedDelta = Math.round(deltaTime.valueOf() / step) * step;
        
        // Use a safer approach to create the new beat offset fraction
        const newBeatOffset = Math.max(0, dragData.originalBeatOffset + snappedDelta / beatLength);
        
        // Create a Fraction object directly using the library
        const newBeatFraction = new Fraction(newBeatOffset);
        
        // Use the toFraction method to get a simplified fraction string
        const fractionStr = newBeatFraction.toFraction();
        
        // Parse the fraction string to get numerator and denominator
        let numerator, denominator;
        if (fractionStr.includes('/')) {
            [numerator, denominator] = fractionStr.split('/');
        } else {
            numerator = fractionStr;
            denominator = '1';
        }
        
        // IMPORTANT: Create the new expression using new Fraction(numerator, denominator) format
        // instead of a decimal multiplier to ensure consistent behavior
        let newRaw = dragData.reference +
            ".getVariable('startTime').add(new Fraction(60).div(module.findTempo(" + dragData.reference +
            ")).mul(new Fraction(" + numerator + ", " + denominator + ")))";
  
        note.setVariable('startTime', function() {
            return new Function("module", "Fraction", "return " + newRaw + ";")(myModule, Fraction);
        });
        note.setVariable('startTimeString', newRaw);
        // Note: setVariable will mark the note as dirty
            
        evaluatedNotes = myModule.evaluateModule();
        updateVisualNotes(evaluatedNotes);
        
        // Store the currently selected note before updating
        const previouslySelectedNote = currentSelectedNote;
        
        // Check if this note is currently selected in the widget
        const isCurrentlySelected = currentSelectedNote && currentSelectedNote.id === note.id;
        if (isCurrentlySelected) {
            // Get the note content element
            const noteContent = document.querySelector(`.note-content[data-note-id="${note.id}"]`);
            if (noteContent) {
                // Update the widget to reflect the new values
                showNoteVariables(note, noteContent);
            }
        } 
        // If another note was selected, reapply its selection and dependency highlights
        else if (previouslySelectedNote && previouslySelectedNote.id !== note.id) {
            const selectedElement = document.querySelector(`[data-note-id="${previouslySelectedNote.id}"]`);
            if (selectedElement) {
                // Re-show the note variables to reapply dependency highlights
                showNoteVariables(previouslySelectedNote, selectedElement);
            }
        }
        
        e.stopPropagation();
    }
  
    // Reset drag state regardless of drag having occurred or not.
    dragData.hasDragged = false;
    dragData.hasCaptured = false;
    if (dragData.hasCaptured) {
        noteRect.element.releasePointerCapture(e.pointerId);
    }
  });
  
  noteRect.element.addEventListener('pointercancel', (e) => {
    // Reset pointer down flag
    dragData.pointerIsDown = false;
    
    const overlayContainer = document.getElementById('drag-overlay-container');
    if (overlayContainer && overlayContainer.parentNode) {
      overlayContainer.parentNode.removeChild(overlayContainer);
    }
    dragData.hasDragged = false;
    dragData.hasCaptured = false;
    if (dragData.hasCaptured) {
      noteRect.element.releasePointerCapture(e.pointerId);
    }
  });

  noteRect.element.addEventListener('pointerleave', (e) => {
    // Only clean up overlay if we're not actively dragging
    if (!dragData.hasDragged) {
      const overlayContainer = document.getElementById('drag-overlay-container');
      if (overlayContainer && overlayContainer.parentNode) {
        overlayContainer.parentNode.removeChild(overlayContainer);
      }
    }
  });

  // Helper: updateDragOverlay creates or updates an overlay element.
  function updateDragOverlay(noteObj, newTime, depId, type) {
    let overlayContainer = document.getElementById('drag-overlay-container');
    if (!overlayContainer) return;
    
    const xCoord = newTime * 200;
    const point = new tapspace.geometry.Point(space, { x: xCoord, y: 0 });
    const screenPos = point.transitRaw(viewport);
    
    const overlayId = type === 'dragged' ? 'drag-overlay-dragged' : 'drag-overlay-dep-' + depId;
    let overlayElem = document.getElementById(overlayId);
    
    if (!overlayElem) {
        overlayElem = document.createElement('div');
        overlayElem.id = overlayId;
        overlayElem.style.position = 'absolute';
        overlayElem.style.top = '0';
        overlayElem.style.height = '100%';
        overlayElem.style.width = '2px';
        overlayElem.style.pointerEvents = 'none';
        overlayElem.style.backgroundColor = type === 'dragged' ? 'rgba(255,0,0,0.5)' : 'rgba(0,0,255,0.5)';
        overlayContainer.appendChild(overlayElem);
    }
    
    overlayElem.style.left = screenPos.x + 'px';
  }

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
  
      const barsContainer = domCache.measureBarsContainer;
      playheadContainer = domCache.playheadContainer;
      const trianglesContainer = domCache.trianglesContainer;
  
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
      invalidateModuleEndTimeCache();
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
  
  let playheadAnimationId = null;

function updatePlayhead() {
    // Cancel any existing animation frame
    if (playheadAnimationId) {
        cancelAnimationFrame(playheadAnimationId);
    }
    
    // Define the update function
    const update = () => {
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
        
        // Schedule the next update
        playheadAnimationId = requestAnimationFrame(update);
    };
    
    // Start the update loop
    update();
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
    
    // IMPORTANT: Update the global newNotes array with all playable notes
    newNotes = [];
    
    // Process all notes from the evaluated notes
    Object.entries(myModule.notes)
        .filter(([id, note]) => note.getVariable('startTime'))
        .forEach(([id, note]) => {
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
                
                // Add to newNotes array for playback
                newNotes.push({
                    ...note,
                    id: parseInt(id),
                    element: noteRect,
                    getBoundingBox: () => noteRect.getBoundingBox()
                });
            } else {
                // Measure bar (we don't create visual elements for these here)
                // Still add to newNotes for reference
                newNotes.push(note);
            }
        });

    updateTimingBoundaries();
    createMeasureBars();  // This creates the visual elements for measure bars

    // Reapply previous selections (if any)
    selectedIds.forEach(id => {
        const newElement = document.querySelector(`.note-content[data-note-id="${id}"], .base-note-circle[data-note-id="${id}"], .measure-bar-triangle[data-note-id="${id}"]`);
        if (newElement) {
            newElement.classList.add('selected');
        }
    });
    
    // Reapply the currentSelectedNote if it exists
    if (currentSelectedNote) {
        const newElement = document.querySelector(`[data-note-id="${currentSelectedNote.id}"]`);
        if (newElement) {
            newElement.classList.add('selected');
        }
    }
    
    // Ensure we invalidate the module end time cache
    invalidateModuleEndTimeCache();
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

function cleanupAudio() {
  // Clear all scheduled timeouts
  scheduledTimeouts.forEach(timeout => clearTimeout(timeout));
  scheduledTimeouts = [];
  
  // Stop and disconnect all active oscillators
  for (const [id, oscObj] of activeOscillators.entries()) {
      try {
          oscObj.gainNode.gain.cancelScheduledValues(audioContext.currentTime);
          oscObj.oscillator.stop();
          
          // Return oscillator and gain node to the pool if there's room
          if (oscillatorPool.length < OSCILLATOR_POOL_SIZE) {
              // Reset the oscillator for future use
              oscObj.oscillator.onended = null;
              oscillatorPool.push(oscObj.oscillator);
              gainNodePool.push(oscObj.gainNode);
          } else {
              // If pool is full, disconnect completely
              oscObj.oscillator.disconnect();
              oscObj.gainNode.disconnect();
          }
      } catch (e) {
          console.log('Oscillator already stopped');
      }
  }
  
  // Clear the active oscillators map
  activeOscillators.clear();
  
  // If audio context is not running, recreate it
  if (audioContext.state !== 'running') {
      audioContext.close().then(() => {
          audioContext = new (window.AudioContext || window.webkitAudioContext)();
          generalVolumeGainNode = audioContext.createGain();
          compressor = audioContext.createDynamicsCompressor();
          generalVolumeGainNode.connect(compressor);
          compressor.connect(audioContext.destination);
          setVolume(domCache.volumeSlider.value);
          
          // Clear pools when creating a new context
          oscillatorPool = [];
          gainNodePool = [];
      });
  }
}

// Generate a unique ID for each oscillator
function generateOscillatorId() {
  return Math.random().toString(36).substr(2, 9);
}

function playNote(note, startTime) {
  try {
      // Always create a new oscillator for each note
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      // Configure oscillator
      oscillator.frequency.value = note.frequency.valueOf();
      oscillator.type = 'sine';
      gainNode.gain.value = 0;
      
      // Set up ADSR envelope
      const duration = note.duration.valueOf();
      const attackTime = duration * ATTACK_TIME_RATIO;
      const decayTime = duration * DECAY_TIME_RATIO;
      const releaseTime = duration * RELEASE_TIME_RATIO;
      const sustainTime = duration - attackTime - decayTime - releaseTime;
      
      // Schedule gain changes
      gainNode.gain.cancelScheduledValues(startTime);
      gainNode.gain.setValueAtTime(0, startTime);
      gainNode.gain.linearRampToValueAtTime(INITIAL_VOLUME, startTime + attackTime);
      gainNode.gain.linearRampToValueAtTime(INITIAL_VOLUME * SUSTAIN_LEVEL, startTime + attackTime + decayTime);
      gainNode.gain.setValueAtTime(INITIAL_VOLUME * SUSTAIN_LEVEL, startTime + attackTime + decayTime + sustainTime);
      gainNode.gain.linearRampToValueAtTime(0, startTime + duration);
      
      // Connect audio nodes
      oscillator.connect(gainNode);
      gainNode.connect(generalVolumeGainNode);
      
      // Generate unique ID for this oscillator
      const oscId = generateOscillatorId();
      
      // Store in active oscillators map
      activeOscillators.set(oscId, { 
          oscillator, 
          gainNode,
          started: false, // Track if the oscillator has been started
          stopped: false  // Track if the oscillator has been stopped
      });
      
      // Schedule start and stop with a timeout to ensure we don't miss the event
      const startDelay = Math.max(0, (startTime - audioContext.currentTime) * 1000);
      const stopDelay = Math.max(0, (startTime + duration - audioContext.currentTime) * 1000);
      
      const startTimeout = setTimeout(() => {
          if (activeOscillators.has(oscId)) {
              const oscObj = activeOscillators.get(oscId);
              if (!oscObj.started && !oscObj.stopped) {
                  oscObj.started = true;
                  try {
                      oscillator.start();
                  } catch (e) {
                      console.error('Error starting oscillator:', e);
                  }
              }
          }
      }, startDelay);
      
      const stopTimeout = setTimeout(() => {
          if (activeOscillators.has(oscId)) {
              const oscObj = activeOscillators.get(oscId);
              if (oscObj.started && !oscObj.stopped) {
                  oscObj.stopped = true;
                  try {
                      oscillator.stop();
                      // Clean up this oscillator
                      oscillator.disconnect();
                      gainNode.disconnect();
                      activeOscillators.delete(oscId);
                  } catch (e) {
                      console.error('Error stopping oscillator:', e);
                  }
              }
          }
      }, stopDelay);
      
      // Store timeouts for cleanup
      scheduledTimeouts.push(startTimeout, stopTimeout);
      
      // Set up onended handler as a backup for cleanup
      oscillator.onended = () => {
          if (activeOscillators.has(oscId)) {
              const oscObj = activeOscillators.get(oscId);
              oscObj.stopped = true;
              oscillator.disconnect();
              gainNode.disconnect();
              activeOscillators.delete(oscId);
          }
      };
  } catch (e) {
      console.error('Error in playNote:', e);
  }
}

function preparePlayback(fromTime) {
  return new Promise((resolve) => {
      console.time('Playback preparation');
      
      // Step 1: Ensure audio context is running
      const resumePromise = audioContext.state === 'suspended' 
          ? audioContext.resume() 
          : Promise.resolve();
          
      resumePromise.then(() => {
          // Step 2: Clean up any existing audio
          cleanupAudio();
          
          // Step 3: Get the latest evaluated notes
          const evaluatedNotes = myModule.evaluateModule();
          const moduleEndTime = getModuleEndTime();
          
          // Step 4: Find all notes that should be played
          const activeNotes = [];
          
          // Process all notes in the module
          for (const id in myModule.notes) {
              const note = myModule.notes[id];
              
              // Skip notes without required properties
              if (!note.getVariable('startTime') || !note.getVariable('duration') || !note.getVariable('frequency')) {
                  continue;
              }
              
              const noteStart = note.getVariable('startTime').valueOf();
              const noteDuration = note.getVariable('duration').valueOf();
              const noteEnd = noteStart + noteDuration;
              
              // Only include notes that overlap with the playback period
              if (noteEnd > fromTime && noteStart < moduleEndTime) {
                  activeNotes.push({
                      id: note.id,
                      startTime: note.getVariable('startTime'),
                      duration: note.getVariable('duration'),
                      frequency: note.getVariable('frequency')
                  });
              }
          }
          
          console.log(`Prepared ${activeNotes.length} notes from time ${fromTime} to ${moduleEndTime}`);
          
          // Step 5: Pre-create all oscillators and gain nodes
          const preparedNotes = activeNotes.map(note => {
              const noteStart = note.startTime.valueOf();
              const noteDuration = note.duration.valueOf();
              const noteEnd = noteStart + noteDuration;
              
              // Calculate adjusted start time and duration based on fromTime
              const adjustedStart = Math.max(0, noteStart - fromTime);
              const adjustedDuration = noteEnd - Math.max(noteStart, fromTime);
              
              return {
                  note: {
                      ...note,
                      startTime: new Fraction(adjustedStart),
                      duration: new Fraction(adjustedDuration)
                  },
                  oscillator: audioContext.createOscillator(),
                  gainNode: audioContext.createGain()
              };
          });
          
          console.timeEnd('Playback preparation');
          resolve(preparedNotes);
      });
  });
}

function play(fromTime = null) {
  // If we're already playing, stop first to clean up
  if (isPlaying) {
      stop(false);
  }
  
  if (fromTime === null) {
      fromTime = playheadTime;
  }
  if (fromTime >= getModuleEndTime()) {
      fromTime = 0;
  }
  
  // Show loading indicator or change button state
  domCache.ppElement.classList.add('loading');
  
  // Prepare everything before starting playback
  preparePlayback(fromTime).then((preparedNotes) => {
      // Now we can start the actual playback with everything prepared
      isPlaying = true;
      isPaused = false;
      
      // Set timing variables
      const startTime = audioContext.currentTime + 0.1; // Small buffer to ensure all notes start correctly
      currentTime = startTime - fromTime;
      playheadTime = fromTime;
      totalPausedTime = 0;
      
      // Start all prepared notes
      preparedNotes.forEach(({ note, oscillator, gainNode }) => {
          try {
              // Configure oscillator
              oscillator.frequency.value = note.frequency.valueOf();
              oscillator.type = 'sine';
              gainNode.gain.value = 0;
              
              // Set up ADSR envelope
              const duration = note.duration.valueOf();
              const attackTime = duration * ATTACK_TIME_RATIO;
              const decayTime = duration * DECAY_TIME_RATIO;
              const releaseTime = duration * RELEASE_TIME_RATIO;
              const sustainTime = duration - attackTime - decayTime - releaseTime;
              
              // Schedule gain changes
              const noteStartTime = startTime + note.startTime.valueOf();
              gainNode.gain.cancelScheduledValues(noteStartTime);
              gainNode.gain.setValueAtTime(0, noteStartTime);
              gainNode.gain.linearRampToValueAtTime(INITIAL_VOLUME, noteStartTime + attackTime);
              gainNode.gain.linearRampToValueAtTime(INITIAL_VOLUME * SUSTAIN_LEVEL, noteStartTime + attackTime + decayTime);
              gainNode.gain.setValueAtTime(INITIAL_VOLUME * SUSTAIN_LEVEL, noteStartTime + attackTime + decayTime + sustainTime);
              gainNode.gain.linearRampToValueAtTime(0, noteStartTime + duration);
              
              // Connect audio nodes
              oscillator.connect(gainNode);
              gainNode.connect(generalVolumeGainNode);
              
              // Generate unique ID for this oscillator
              const oscId = generateOscillatorId();
              
              // Store in active oscillators map
              activeOscillators.set(oscId, { 
                  oscillator, 
                  gainNode,
                  started: false,
                  stopped: false
              });
              
              // Start the oscillator
              oscillator.start(noteStartTime);
              oscillator.stop(noteStartTime + duration);
              
              // Mark as started once we've called start
              const oscObj = activeOscillators.get(oscId);
              if (oscObj) {
                  oscObj.started = true;
              }
              
              // Set up onended handler for cleanup
              oscillator.onended = () => {
                  if (activeOscillators.has(oscId)) {
                      const oscObj = activeOscillators.get(oscId);
                      oscObj.stopped = true;
                      oscillator.disconnect();
                      gainNode.disconnect();
                      activeOscillators.delete(oscId);
                  }
              };
          } catch (e) {
              console.error('Failed to play prepared note:', e, note);
          }
      });
      
      // Update UI to show playing state
      domCache.ppElement.classList.remove('loading');
      domCache.ppElement.classList.add('open');
  });
}

function startPlayback(fromTime) {
  // This is now just a wrapper around our new preparation and playback system
  preparePlayback(fromTime).then((preparedNotes) => {
      const startTime = audioContext.currentTime + 0.1;
      currentTime = startTime - fromTime;
      playheadTime = fromTime;
      totalPausedTime = 0;
      
      preparedNotes.forEach(({ note, oscillator, gainNode }) => {
          try {
              // Configure oscillator
              oscillator.frequency.value = note.frequency.valueOf();
              oscillator.type = 'sine';
              gainNode.gain.value = 0;
              
              // Set up ADSR envelope
              const duration = note.duration.valueOf();
              const attackTime = duration * ATTACK_TIME_RATIO;
              const decayTime = duration * DECAY_TIME_RATIO;
              const releaseTime = duration * RELEASE_TIME_RATIO;
              const sustainTime = duration - attackTime - decayTime - releaseTime;
              
              // Schedule gain changes
              const noteStartTime = startTime + note.startTime.valueOf();
              gainNode.gain.cancelScheduledValues(noteStartTime);
              gainNode.gain.setValueAtTime(0, noteStartTime);
              gainNode.gain.linearRampToValueAtTime(INITIAL_VOLUME, noteStartTime + attackTime);
              gainNode.gain.linearRampToValueAtTime(INITIAL_VOLUME * SUSTAIN_LEVEL, noteStartTime + attackTime + decayTime);
              gainNode.gain.setValueAtTime(INITIAL_VOLUME * SUSTAIN_LEVEL, noteStartTime + attackTime + decayTime + sustainTime);
              gainNode.gain.linearRampToValueAtTime(0, noteStartTime + duration);
              
              // Connect audio nodes
              oscillator.connect(gainNode);
              gainNode.connect(generalVolumeGainNode);
              
              // Generate unique ID for this oscillator
              const oscId = generateOscillatorId();
              
              // Store in active oscillators map
              activeOscillators.set(oscId, { 
                  oscillator, 
                  gainNode,
                  started: false,
                  stopped: false
              });
              
              // Start the oscillator
              oscillator.start(noteStartTime);
              oscillator.stop(noteStartTime + duration);
              
              // Mark as started once we've called start
              const oscObj = activeOscillators.get(oscId);
              if (oscObj) {
                  oscObj.started = true;
              }
              
              // Set up onended handler for cleanup
              oscillator.onended = () => {
                  if (activeOscillators.has(oscId)) {
                      const oscObj = activeOscillators.get(oscId);
                      oscObj.stopped = true;
                      oscillator.disconnect();
                      gainNode.disconnect();
                      activeOscillators.delete(oscId);
                  }
              };
          } catch (e) {
              console.error('Failed to play prepared note:', e, note);
          }
      });
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
  
  // Fade out all currently playing notes
  for (const [id, oscObj] of activeOscillators.entries()) {
      try {
          oscObj.gainNode.gain.cancelScheduledValues(audioContext.currentTime);
          oscObj.gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + GENERAL_VOLUME_RAMP_TIME);
      } catch (e) {
          console.log('Error fading out oscillator:', e);
      }
  }
  
  // Clean up after fade out
  setTimeout(() => {
      cleanupAudio();
      isPlaying = false;
      isFadingOut = false;
  }, GENERAL_VOLUME_RAMP_TIME * 1000);
  
  // Use cached DOM element
  domCache.ppElement.classList.remove('open');
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
  
  // Use cached DOM element
  domCache.ppElement.classList.remove('open');
  
  // Clean up all audio resources
  cleanupAudio();
  
  // Update the playhead position
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
        // Use cached DOM elements
        if (!domCache.noteWidget.contains(event.target) && 
            !event.target.closest('.note-rect') && 
            !event.target.closest('#baseNoteCircle') &&
            !event.target.closest('.measure-bar-triangle') &&
            !event.target.closest('.delete-confirm-overlay')) {
            clearSelection();
        }
        if (!domCache.generalWidget.contains(event.target) && !domCache.dropdownButton.contains(event.target)) {
            domCache.plusminus.classList.remove('open');
            domCache.generalWidget.classList.remove('open');
        }
    }
    isDragging = false;
});

// Use cached DOM elements for event listeners
domCache.dropdownButton.addEventListener('click', (event) => {
    event.stopPropagation();
    domCache.plusminus.classList.toggle('open');
    domCache.generalWidget.classList.toggle('open');
});

domCache.volumeSlider.addEventListener('touchstart', function() {
    this.classList.add('active');
});

domCache.volumeSlider.addEventListener('touchend', function() {
    this.classList.remove('active');
});

// Cache slider elements once
const sliders = document.querySelectorAll('.slider-container input[type="range"]');
sliders.forEach(slider => {
    const valueDisplay = slider.parentElement.querySelector('span');
    slider.addEventListener('input', (e) => {
        valueDisplay.textContent = e.target.value;
    });
});

domCache.trackingToggle.addEventListener('change', (event) => {
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

domCache.playPauseBtn.addEventListener('click', () => {
    if (isPlaying) {
        pause();
    } else {
        play(playheadTime);
    }
});

domCache.stopButton.addEventListener('click', () => {
    stop(true);
});

domCache.volumeSlider.addEventListener('input', (event) => {
    setVolume(event.target.value);
});

if (domCache.loadModuleBtn && domCache.loadModuleInput) {
    domCache.loadModuleBtn.addEventListener('click', () => {
        domCache.loadModuleInput.click();
    });
    domCache.loadModuleInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (file) {
            loadModule(file);
        }
        event.target.value = '';
    });
} else {
    console.error('Load Module button or input not found!');
}

if (domCache.reorderModuleBtn) {
    domCache.reorderModuleBtn.addEventListener('click', function() {
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
        
        // Store the current view position to restore it later
        const currentViewCenter = viewport.atCenter().transitRaw(space);
        
        // Completely clean up the current module
        cleanupCurrentModule();
        
        // Clear all caches
        memoizedModuleEndTime = null;
        moduleLastModifiedTime = Date.now();
        
        // Reset dependency caches
        if (window.modals && window.modals.invalidateDependencyGraphCache) {
            window.modals.invalidateDependencyGraphCache();
        }
        
        // Load the reordered module
        Module.loadFromJSON(data).then(newModule => {
            // Replace the global module reference
            myModule = newModule;
            window.myModule = newModule;
            
            // Clear any lingering caches in the module
            myModule._evaluationCache = {};
            myModule._dirtyNotes.clear();
            myModule._dependenciesCache.clear();
            myModule._dependentsCache.clear();
            
            // Mark all notes as dirty to force reevaluation
            for (const id in myModule.notes) {
                myModule.markNoteDirty(Number(id));
            }
            
            // Initialize the module with fresh state
            initializeModule();
            
            // Restore the view position
            const newPoint = space.at(currentViewCenter.x, currentViewCenter.y);
            viewport.translateTo(newPoint);
            
            // Force a complete re-evaluation of the module
            evaluatedNotes = myModule.evaluateModule();
            updateVisualNotes(evaluatedNotes);
            
            console.log("Module reordering complete with full cache reset");
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
                invalidateModuleEndTimeCache();
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
    return window.modals.validateExpression(moduleInstance, noteId, expression, variableType);
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
// Renamed to avoid conflict with existing function
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
    window.modals.invalidateDependencyGraphCache();
}

const TOP_HEADER_HEIGHT = 50;
const MIN_BUFFER = 20;
let widgetInitiallyOpened = false;

function updateNoteWidgetHeight() {
    window.modals.updateNoteWidgetHeight();
}
  
updateNoteWidgetHeight();

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

});