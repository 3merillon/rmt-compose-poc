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

let memoizedModuleEndTime = null;
let moduleLastModifiedTime = 0;

function invalidateModuleEndTimeCache() {
    //console.log('Invalidating module end time cache');
    memoizedModuleEndTime = null;
    moduleLastModifiedTime = Date.now();
}

class Module {
    constructor(baseNoteVariables = {}) {
        this.notes = {};
        this.nextId = 1;
        
        // Add caching properties for evaluation
        this._evaluationCache = {};
        this._lastEvaluationTime = 0;
        this._dirtyNotes = new Set();

        // Add caching for dependencies
        this._dependenciesCache = new Map();
        this._dependentsCache = new Map();

        // Default variables for the base note
        const defaultBaseNoteVariables = {
            frequency: () => new Fraction(440),
            startTime: () => new Fraction(0),
            tempo: () => new Fraction(60), // beats per minute
            beatsPerMeasure: () => new Fraction(4),
            measureLength: () => {
                const tempo = this.getNoteById(0).getVariable('tempo');
                const beatsPerMeasure = this.getNoteById(0).getVariable('beatsPerMeasure');
                return beatsPerMeasure.div(tempo).mul(60);
            },
        };

        // Merge default variables with provided variables
        const finalBaseNoteVariables = { ...defaultBaseNoteVariables, ...baseNoteVariables };

        // Create the base note with ID 0
        this.baseNote = new Note(0, finalBaseNoteVariables);
        this.baseNote.module = this; // Set module reference
        this.notes[0] = this.baseNote;
    }
    
    // Method to mark a note as dirty
    markNoteDirty(noteId) {
        this._dirtyNotes.add(Number(noteId));
        
        // Invalidate dependency caches for this note
        this._dependenciesCache.delete(Number(noteId));
        this._dependentsCache.clear(); // Clear all dependents cache as this could affect many notes
        
        // Also mark all dependent notes as dirty
        const dependents = this.getDependentNotes(Number(noteId));
        dependents.forEach(depId => {
            this._dirtyNotes.add(Number(depId));
        });
    }

    getDirectDependencies(noteId) {
        // Check cache first
        if (this._dependenciesCache.has(noteId)) {
            return this._dependenciesCache.get(noteId);
        }
        
        const note = this.getNoteById(noteId);
        if (!note || !note.variables) {
            return [];
        }
        
        const dependencies = new Set();
        
        // Add explicit dependencies if any
        if (this._explicitDependencies && this._explicitDependencies.has(noteId)) {
            const explicitDeps = this._explicitDependencies.get(noteId);
            explicitDeps.forEach(depId => dependencies.add(depId));
        }
        
        // Add dependencies from variable expressions
        function findReferences(expr) {
            const regex = /getNoteById\((\d+)\)/g;
            const references = new Set();
            let match;
            while ((match = regex.exec(expr)) !== null) {
                references.add(parseInt(match[1]));
            }
            return references;
        }
        
        for (const [key, value] of Object.entries(note.variables)) {
            if (typeof value === 'function') {
                const funcString = value.toString();
                const refs = findReferences(funcString);
                refs.forEach(ref => dependencies.add(ref));
            } else if (key.endsWith('String')) {
                const refs = findReferences(value);
                refs.forEach(ref => dependencies.add(ref));
            }
        }
        
        const result = Array.from(dependencies);
        // Store in cache
        this._dependenciesCache.set(noteId, result);
        return result;
    }

    getDependentNotes(noteId) {
        if (noteId == null) return [];
        
        // Check cache first
        if (this._dependentsCache.has(noteId)) {
            return this._dependentsCache.get(noteId);
        }
        
        const dependents = new Set();
        const visited = new Set(); // To prevent infinite recursion in circular dependencies
        
        const checkDependencies = (id) => {
            if (visited.has(id)) return;
            visited.add(id);
            
            for (const [checkId, note] of Object.entries(this.notes)) {
                if (!note) continue;
                if (checkId !== String(id)) {
                    // Use cached dependencies if available
                    let deps;
                    if (this._dependenciesCache.has(Number(checkId))) {
                        deps = this._dependenciesCache.get(Number(checkId));
                    } else {
                        deps = this.getDirectDependencies(Number(checkId));
                    }
                    
                    if (deps.includes(id)) {
                        dependents.add(Number(checkId));
                        checkDependencies(Number(checkId));
                    }
                }
            }
        };
        
        checkDependencies(noteId);
        
        const result = Array.from(dependents);
        // Store in cache
        this._dependentsCache.set(noteId, result);
        return result;
    }

    addNote(variables = {}) {
        const id = this.nextId++;
        const note = new Note(id, variables);
        note.module = this; // Set module reference
        this.notes[id] = note;
        this.markNoteDirty(id);
        invalidateModuleEndTimeCache();
        return note;
    }
    
    removeNote(id) {
        delete this.notes[id];
        delete this._evaluationCache[id];
        this.markNoteDirty(id); // Mark dependents as dirty
        invalidateModuleEndTimeCache();
    }

    getNoteById(id) {
        return this.notes[id];
    }

    evaluateModule() {
        const currentTime = Date.now();
        
        // If no notes are dirty and we have a valid cache, return the cached result
        if (this._dirtyNotes.size === 0 && 
            Object.keys(this._evaluationCache).length > 0 && 
            this._lastEvaluationTime > 0) {
            return { ...this._evaluationCache };
        }
        
        // Start with the existing cache
        const evaluatedNotes = { ...this._evaluationCache };
        
        // Get the list of notes to evaluate
        const notesToEvaluate = this._dirtyNotes.size > 0 
            ? [...this._dirtyNotes] 
            : Object.keys(this.notes).map(id => parseInt(id, 10));
        
        // Evaluate only the dirty notes and their dependents
        notesToEvaluate.forEach(id => {
            const note = this.notes[id];
            if (note) {
                evaluatedNotes[id] = note.getAllVariables();
            } else {
                // If a note was deleted, remove it from the cache
                delete evaluatedNotes[id];
            }
        });
        
        // Update the cache and reset dirty notes
        this._evaluationCache = { ...evaluatedNotes };
        this._lastEvaluationTime = currentTime;
        this._dirtyNotes.clear();
        
        return evaluatedNotes;
    }

	findMeasureLength(note) {
        // Explicitly track dependency on BaseNote
        this._trackDependency(note.id, 0);
        
        // Get current tempo and beats per measure
        const tempo = this.findTempo(note);
        const beatsPerMeasure = this.baseNote.getVariable('beatsPerMeasure');
        // Calculate measure length: (beats/measure) / (beats/minute) * (60 seconds/minute)
        return beatsPerMeasure.div(tempo).mul(60);
    }

    findTempo(note) {
        // Explicitly track dependency on BaseNote
        this._trackDependency(note.id, 0);
        
        while (note) {
            if (note.variables.tempo) {
                return note.getVariable('tempo');
            }
            note = this.getNoteById(note.parentId);
        }
        return this.baseNote.getVariable('tempo');
    }

    _trackDependency(noteId, dependencyId) {
        // Skip if noteId is undefined or null
        if (noteId == null) return;
        
        // Get or create the dependencies set for this note
        if (!this._explicitDependencies) {
            this._explicitDependencies = new Map();
        }
        
        if (!this._explicitDependencies.has(noteId)) {
            this._explicitDependencies.set(noteId, new Set());
        }
        
        // Add the dependency
        this._explicitDependencies.get(noteId).add(dependencyId);
    }

    generateMeasures(fromNote, n) {
        const notesArray = [];
        for (let i = 0; i < n; i++) {
          const prevNote = (i === 0) ? fromNote : this.getNoteById(notesArray[i - 1].id);
          const measureLength = this.findMeasureLength(prevNote);
          
          // Define the new startTime as a function that doesn't reference itself
          const newStartTimeFunction = () => {
            if (i === 0) {
              return prevNote.getVariable('startTime').add(measureLength);
            } else {
              const prevStartTime = notesArray[i - 1].getVariable('startTime');
              return prevStartTime.add(measureLength);
            }
          };
      
          // Construct the raw string
          let rawString;
          if (prevNote.id === 0) {
            rawString = "module.baseNote.getVariable('startTime').add(module.findMeasureLength(module.baseNote))";
          } else {
            rawString = `module.getNoteById(${prevNote.id}).getVariable('startTime').add(module.findMeasureLength(module.getNoteById(${prevNote.id})))`;
          }
      
          // Create the new note with both the function and the raw string
          const newNote = this.addNote({
            startTime: newStartTimeFunction,
            startTimeString: rawString
          });
          newNote.parentId = prevNote.id;
          notesArray.push(newNote);
        }
        return notesArray;
    }

    static async loadFromJSON(source) {
        let data;
        
        if (typeof source === 'string') {
            const response = await fetch(source);
            data = await response.json();
        } else {
            data = source;
        }
        
        // Create base note variables using the provided strings.
        const baseNoteVariables = {
            frequency: () => (new Function("module", "Fraction", "getNoteById", "return " + data.baseNote.frequency + ";"))(null, Fraction, null),
            frequencyString: data.baseNote.frequency,
            startTime: () => (new Function("module", "Fraction", "getNoteById", "return " + data.baseNote.startTime + ";"))(null, Fraction, null),
            startTimeString: data.baseNote.startTime,
            tempo: () => (new Function("module", "Fraction", "getNoteById", "return " + data.baseNote.tempo + ";"))(null, Fraction, null),
            tempoString: data.baseNote.tempo,
            beatsPerMeasure: () => (new Function("module", "Fraction", "getNoteById", "return " + data.baseNote.beatsPerMeasure + ";"))(null, Fraction, null),
            beatsPerMeasureString: data.baseNote.beatsPerMeasure
        };
    
        // Create a new Module instance with the above base note.
        const moduleInstance = new Module(baseNoteVariables);
        
        // Process each note in data.notes.
        data.notes.forEach((noteData) => {
            const variables = {};
            const noteId = parseInt(noteData.id);
            
            // Process all properties except "id".
            Object.entries(noteData).forEach(([key, value]) => {
                if (key !== 'id') {
                    if (key === 'color') {
                        // Store color as direct value
                        variables[key] = value;
                    } else if (typeof value === "string" && (value.includes('module.') || value.includes('new Fraction') || value.includes('eval(') || value.includes('getNoteById'))) {
                        // Create a new function that takes module, Fraction, and getNoteById as parameters.
                        const func = new Function("module", "Fraction", "getNoteById", "return " + value + ";");
                        // When called, pass the module instance, Fraction, and the module's getNoteById (bound to moduleInstance).
                        variables[key] = function() {
                            return func(moduleInstance, Fraction, moduleInstance.getNoteById.bind(moduleInstance));
                        };
                        variables[key + 'String'] = value;
                    } else {
                        // Otherwise, store the value directly.
                        variables[key] = value;
                    }
                }
            });
            
            // If noteId is a valid number, create the note with that id.
            if (!isNaN(noteId)) {
                const note = new Note(noteId, variables);
                note.module = moduleInstance; // Set module reference
                moduleInstance.notes[noteId] = note;
                // Ensure nextId is updated.
                if (noteId >= moduleInstance.nextId) {
                    moduleInstance.nextId = noteId + 1;
                }
            } else {
                moduleInstance.addNote(variables);
            }
        });
        
        // Ensure the base note has a module reference
        moduleInstance.baseNote.module = moduleInstance;
        
        return moduleInstance;
    }

    static async loadFromData(data) {
        const baseNoteVariables = {
            frequency: () => eval(data.baseNote.frequency),
            frequencyString: data.baseNote.frequency,
            startTime: () => eval(data.baseNote.startTime),
            startTimeString: data.baseNote.startTime,
            tempo: () => eval(data.baseNote.tempo),
            tempoString: data.baseNote.tempo,
            beatsPerMeasure: () => eval(data.baseNote.beatsPerMeasure),
            beatsPerMeasureString: data.baseNote.beatsPerMeasure
        };
    
        const module = new Module(baseNoteVariables);
    
        data.notes.forEach((noteData) => {
            const variables = {};
    
            if (noteData.startTime) {
                variables.startTime = () => eval(noteData.startTime);
                variables.startTimeString = noteData.startTime;
            }
            if (noteData.duration) {
                variables.duration = () => eval(noteData.duration);
                variables.durationString = noteData.duration;
            }
            if (noteData.frequency) {
                variables.frequency = () => eval(noteData.frequency);
                variables.frequencyString = noteData.frequency;
            }
            if (noteData.color) {
                variables.color = noteData.color;
            }
    
            module.addNote(variables);
        });
    
        return module;
    }

    async exportOrderedModule() {
        // Export the live module to a raw data object.
        const moduleData = this.createModuleJSON();
        // Load the temporary module using loadFromJSON so that baseNote expressions are handled correctly.
        const tempModule = await Module.loadFromJSON(moduleData);
        // Reorder the temporary module (currently reindexModule is a dummy).
        tempModule.reindexModule();
        // Return its JSON string.
        return JSON.stringify(tempModule.createModuleJSON(), null, 2);
    }

    createModuleJSON() {
      const moduleObj = {};
    
      // Export base note:
      const baseObj = {};
      Object.keys(this.baseNote.variables).forEach(key => {
        if (key.endsWith("String")) {
          // Remove "String" suffix.
          const prop = key.slice(0, -6);
          baseObj[prop] = this.baseNote.variables[key];
        } else if (key === "color") {
          baseObj[key] = this.baseNote.variables[key];
        }
      });
      moduleObj.baseNote = baseObj;
    
      // Export notes (except base note)
      const notesArray = [];
      Object.values(this.notes).forEach(note => {
        if (note.id === 0) return;
        const noteObj = { id: note.id };
        Object.keys(note.variables).forEach(key => {
          if (key.endsWith("String")) {
            const prop = key.slice(0, -6);
            noteObj[prop] = note.variables[key];
          } else if (key === "color") {
            noteObj[key] = note.variables[key];
          }
        });
        notesArray.push(noteObj);
      });
      notesArray.sort((a, b) => a.id - b.id);
      moduleObj.notes = notesArray;
    
      return moduleObj;
   }

   reindexModule() {
    // Preserve the base note as id 0.
    const baseNote = this.baseNote;
    
    // Store original colors keyed by note id
    const originalColors = {};
    for (const id in this.notes) {
        if (this.notes[id].variables && this.notes[id].variables.color) {
            originalColors[id] = this.notes[id].variables.color;
        }
    }
    
    // Separate notes (except base note) into measure notes and regular notes.
    const measureNotes = [];
    const regularNotes = [];
    for (const id in this.notes) {
        const note = this.notes[id];
        if (Number(id) === 0) continue;
        // Measure notes: have a startTime but no duration/frequency.
        if (note.variables.startTime && !note.variables.duration && !note.variables.frequency) {
            measureNotes.push(note);
        } else {
            regularNotes.push(note);
        }
    }
    
    // Sort both arrays by evaluated startTime.
    measureNotes.sort((a, b) => a.getVariable("startTime").valueOf() - b.getVariable("startTime").valueOf());
    regularNotes.sort((a, b) => a.getVariable("startTime").valueOf() - b.getVariable("startTime").valueOf());
    
    // Build a mapping from old id to new sequential id.
    const newMapping = {};
    newMapping[baseNote.id] = 0;
    let newId = 1;
    for (const note of measureNotes) {
        newMapping[note.id] = newId;
        newId++;
    }
    for (const note of regularNotes) {
        newMapping[note.id] = newId;
        newId++;
    }
    
    // Store the old parentId relationships
    const parentRelationships = {};
    for (const id in this.notes) {
        const note = this.notes[id];
        if (note.parentId !== undefined) {
            parentRelationships[id] = note.parentId;
        }
    }
    
    function updateRawDependencies(str) {
        return str.replace(/(?:module\.)?getNoteById\(\s*(\d+)\s*\)/g, (match, p1) => {
            const oldRefId = parseInt(p1, 10);
            if (oldRefId === 0) {
                return "module.baseNote";
            }
            const newRefId = newMapping[oldRefId];
            if (typeof newRefId !== "number") {
                console.warn("No new mapping found for old id " + oldRefId);
                return match;
            }
            return "module.getNoteById(" + newRefId + ")";
        });
    }
    
    // Create a new notes object
    const newNotes = {};
    newNotes[0] = baseNote;
    
    // Process each non-base note
    for (const oldId in this.notes) {
        if (Number(oldId) === 0) continue;
        const note = this.notes[oldId];
        const updatedId = newMapping[note.id];
        
        // Create new note with all variables
        const variables = {};
        
        // Copy all variables
        for (const key in note.variables) {
            if (key.endsWith("String")) {
                variables[key] = updateRawDependencies(note.variables[key]);
                const baseKey = key.slice(0, -6);
                variables[baseKey] = function() {
                    return new Function("module", "Fraction", "return " + variables[key] + ";")(this, Fraction);
                };
            } else if (key === 'color') {
                // Copy color directly
                variables[key] = note.variables[key];
            }
        }
        
        // Create new note with copied variables
        const newNote = new Note(updatedId, variables);
        
        // Update module reference
        newNote.module = this;
        
        // Copy parentId if it exists and update it
        if (parentRelationships[oldId] !== undefined) {
            const oldParentId = parentRelationships[oldId];
            newNote.parentId = newMapping[oldParentId] !== undefined ? newMapping[oldParentId] : 0;
        }
        
        newNotes[updatedId] = newNote;
    }
    
    // Replace the module's notes with the newly reindexed notes
    this.notes = newNotes;
    
    // Reset all caches
    this._evaluationCache = {};
    this._lastEvaluationTime = 0;
    this._dirtyNotes = new Set();
    this._dependenciesCache = new Map();
    this._dependentsCache = new Map();
    
    // Mark all notes as dirty to ensure proper reevaluation
    for (const id in this.notes) {
        this._dirtyNotes.add(Number(id));
    }
    
    // Invalidate module end time cache if the function exists
    if (typeof invalidateModuleEndTimeCache === 'function') {
        invalidateModuleEndTimeCache();
    }
    
    // Log the reindexing for debugging
    console.log("Module reindexed. New mapping:", newMapping);
  }
}