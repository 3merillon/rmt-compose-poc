import Fraction from 'fraction.js';
import { Note } from './note.js';

let memoizedModuleEndTime = null;
let moduleLastModifiedTime = 0;

export function invalidateModuleEndTimeCache() {
    memoizedModuleEndTime = null;
    moduleLastModifiedTime = Date.now();
}


export class Module {
    constructor(baseNoteVariables = {}) {
        this.notes = {};
        this.nextId = 1;
        this._evaluationCache = {};
        this._lastEvaluationTime = 0;
        this._dirtyNotes = new Set();
        this._dependenciesCache = new Map();
        this._dependentsCache = new Map();

        const defaultBaseNoteVariables = {
            frequency: () => new Fraction(440),
            startTime: () => new Fraction(0),
            tempo: () => new Fraction(60),
            beatsPerMeasure: () => new Fraction(4),
            instrument: 'sine-wave',
            measureLength: () => {
                const tempo = this.getNoteById(0).getVariable('tempo');
                const beatsPerMeasure = this.getNoteById(0).getVariable('beatsPerMeasure');
                return beatsPerMeasure.div(tempo).mul(60);
            },
        };

        const finalBaseNoteVariables = { ...defaultBaseNoteVariables, ...baseNoteVariables };
        this.baseNote = new Note(0, finalBaseNoteVariables);
        this.baseNote.module = this;
        this.notes[0] = this.baseNote;
    }
    
    markNoteDirty(noteId) {
        this._dirtyNotes.add(Number(noteId));
        this._dependenciesCache.delete(Number(noteId));
        this._dependentsCache.clear();
        const dependents = this.getDependentNotes(Number(noteId));
        dependents.forEach(depId => this._dirtyNotes.add(Number(depId)));
    }

    getDirectDependencies(noteId) {
        if (this._dependenciesCache.has(noteId)) return this._dependenciesCache.get(noteId);
        
        const note = this.getNoteById(noteId);
        if (!note || !note.variables) return [];
        
        const dependencies = new Set();
        
        if (this._explicitDependencies && this._explicitDependencies.has(noteId)) {
            const explicitDeps = this._explicitDependencies.get(noteId);
            explicitDeps.forEach(depId => dependencies.add(depId));
        }
        
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
        this._dependenciesCache.set(noteId, result);
        return result;
    }

    getDependentNotes(noteId) {
        if (noteId == null) return [];
        if (this._dependentsCache.has(noteId)) return this._dependentsCache.get(noteId);
        
        const dependents = new Set();
        const visited = new Set();
        
        const checkDependencies = (id) => {
            if (visited.has(id)) return;
            visited.add(id);
            
            for (const [checkId, note] of Object.entries(this.notes)) {
                if (!note) continue;
                if (checkId !== String(id)) {
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
        this._dependentsCache.set(noteId, result);
        return result;
    }

    addNote(variables = {}) {
        const id = this.nextId++;
        const note = new Note(id, variables);
        note.module = this;
        this.notes[id] = note;
        this.markNoteDirty(id);
        invalidateModuleEndTimeCache();
        return note;
    }
    
    removeNote(id) {
        delete this.notes[id];
        delete this._evaluationCache[id];
        this.markNoteDirty(id);
        invalidateModuleEndTimeCache();
    }

    getNoteById(id) {
        return this.notes[id];
    }

    evaluateModule() {
        const currentTime = Date.now();
        
        if (this._dirtyNotes.size === 0 && 
            Object.keys(this._evaluationCache).length > 0 && 
            this._lastEvaluationTime > 0) {
            return { ...this._evaluationCache };
        }
        
        const evaluatedNotes = { ...this._evaluationCache };
        const notesToEvaluate = this._dirtyNotes.size > 0 
            ? [...this._dirtyNotes] 
            : Object.keys(this.notes).map(id => parseInt(id, 10));
        
        notesToEvaluate.forEach(id => {
            const note = this.notes[id];
            if (note) {
                evaluatedNotes[id] = note.getAllVariables();
            } else {
                delete evaluatedNotes[id];
            }
        });
        
        this._evaluationCache = { ...evaluatedNotes };
        this._lastEvaluationTime = currentTime;
        this._dirtyNotes.clear();
        
        return evaluatedNotes;
    }

    findMeasureLength(note) {
        this._trackDependency(note.id, 0);
        const tempo = this.findTempo(note);
        const beatsPerMeasure = this.baseNote.getVariable('beatsPerMeasure');
        return beatsPerMeasure.div(tempo).mul(60);
    }

    findTempo(note) {
        this._trackDependency(note.id, 0);
        while (note) {
            if (note.variables.tempo) return note.getVariable('tempo');
            note = this.getNoteById(note.parentId);
        }
        return this.baseNote.getVariable('tempo');
    }

    findInstrument(note) {
        this._trackDependency(note.id, 0);
        if (!note.variables.frequency && !note.getVariable('frequency')) return 'sine-wave';
        if (note.variables.instrument !== undefined) return note.getVariable('instrument');
        
        let currentNote = note;
        const freqString = currentNote.variables.frequencyString;
        if (freqString) {
            const noteRefMatch = freqString.match(/module\.getNoteById\((\d+)\)\.getVariable\('frequency'\)/);
            if (noteRefMatch) {
                const parentId = parseInt(noteRefMatch[1], 10);
                const parentNote = this.getNoteById(parentId);
                if (parentNote) return this.findInstrument(parentNote);
            }
            
            if (freqString.includes("module.baseNote.getVariable('frequency')")) {
                return this.findInstrument(this.baseNote);
            }
        }
        
        return 'sine-wave';
    }

    _trackDependency(noteId, dependencyId) {
        if (noteId == null) return;
        if (!this._explicitDependencies) this._explicitDependencies = new Map();
        if (!this._explicitDependencies.has(noteId)) this._explicitDependencies.set(noteId, new Set());
        this._explicitDependencies.get(noteId).add(dependencyId);
    }

    generateMeasures(fromNote, n) {
        const notesArray = [];
        for (let i = 0; i < n; i++) {
          const prevNote = (i === 0) ? fromNote : this.getNoteById(notesArray[i - 1].id);
          const measureLength = this.findMeasureLength(prevNote);
          
          const newStartTimeFunction = () => {
            if (i === 0) {
              return prevNote.getVariable('startTime').add(measureLength);
            } else {
              const prevStartTime = notesArray[i - 1].getVariable('startTime');
              return prevStartTime.add(measureLength);
            }
          };
      
          let rawString;
          if (prevNote.id === 0) {
            rawString = "module.baseNote.getVariable('startTime').add(module.findMeasureLength(module.baseNote))";
          } else {
            rawString = `module.getNoteById(${prevNote.id}).getVariable('startTime').add(module.findMeasureLength(module.getNoteById(${prevNote.id})))`;
          }
      
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
        
        const baseNoteVariables = {
            frequency: () => (new Function("module", "Fraction", "getNoteById", "return " + data.baseNote.frequency + ";"))(null, Fraction, null),
            frequencyString: data.baseNote.frequency,
            startTime: () => (new Function("module", "Fraction", "getNoteById", "return " + data.baseNote.startTime + ";"))(null, Fraction, null),
            startTimeString: data.baseNote.startTime,
            tempo: () => (new Function("module", "Fraction", "getNoteById", "return " + data.baseNote.tempo + ";"))(null, Fraction, null),
            tempoString: data.baseNote.tempo,
            beatsPerMeasure: () => (new Function("module", "Fraction", "getNoteById", "return " + data.baseNote.beatsPerMeasure + ";"))(null, Fraction, null),
            beatsPerMeasureString: data.baseNote.beatsPerMeasure,
            instrument: data.baseNote.instrument || 'sine-wave'
        };
    
        const moduleInstance = new Module(baseNoteVariables);
        
        data.notes.forEach((noteData) => {
            const variables = {};
            const noteId = parseInt(noteData.id);
            
            Object.entries(noteData).forEach(([key, value]) => {
                if (key !== 'id') {
                    if (key === 'color' || key === 'instrument') {
                        variables[key] = value;
                    } else if (typeof value === "string" && (value.includes('module.') || value.includes('new Fraction') || value.includes('eval(') || value.includes('getNoteById'))) {
                        const func = new Function("module", "Fraction", "getNoteById", "return " + value + ";");
                        variables[key] = function() {
                            return func(moduleInstance, Fraction, moduleInstance.getNoteById.bind(moduleInstance));
                        };
                        variables[key + 'String'] = value;
                    } else {
                        variables[key] = value;
                    }
                }
            });
            
            if (!isNaN(noteId)) {
                const note = new Note(noteId, variables);
                note.module = moduleInstance;
                moduleInstance.notes[noteId] = note;
                if (noteId >= moduleInstance.nextId) {
                    moduleInstance.nextId = noteId + 1;
                }
            } else {
                moduleInstance.addNote(variables);
            }
        });
        
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
        const moduleData = this.createModuleJSON();
        const tempModule = await Module.loadFromJSON(moduleData);
        tempModule.reindexModule();
        return JSON.stringify(tempModule.createModuleJSON(), null, 2);
    }

    createModuleJSON() {
      const moduleObj = {};
    
      const baseObj = {};
      Object.keys(this.baseNote.variables).forEach(key => {
        if (key.endsWith("String")) {
          const prop = key.slice(0, -6);
          baseObj[prop] = this.baseNote.variables[key];
        } else if (key === "color" || key === "instrument") {
          baseObj[key] = this.baseNote.variables[key];
        }
      });
      moduleObj.baseNote = baseObj;
    
      const notesArray = [];
      Object.values(this.notes).forEach(note => {
        if (note.id === 0) return;
        const noteObj = { id: note.id };
        Object.keys(note.variables).forEach(key => {
          if (key.endsWith("String")) {
            const prop = key.slice(0, -6);
            noteObj[prop] = note.variables[key];
          } else if (key === "color" || key === "instrument") {
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
    const baseNote = this.baseNote;
    const originalColors = {};
    for (const id in this.notes) {
        if (this.notes[id].variables && this.notes[id].variables.color) {
            originalColors[id] = this.notes[id].variables.color;
        }
    }
    
    const measureNotes = [];
    const regularNotes = [];
    for (const id in this.notes) {
        const note = this.notes[id];
        if (Number(id) === 0) continue;
        if (note.variables.startTime && !note.variables.duration && !note.variables.frequency) {
            measureNotes.push(note);
        } else {
            regularNotes.push(note);
        }
    }
    
    measureNotes.sort((a, b) => a.getVariable("startTime").valueOf() - b.getVariable("startTime").valueOf());
    regularNotes.sort((a, b) => a.getVariable("startTime").valueOf() - b.getVariable("startTime").valueOf());
    
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
    
    const newNotes = {};
    newNotes[0] = baseNote;
    
    for (const oldId in this.notes) {
        if (Number(oldId) === 0) continue;
        const note = this.notes[oldId];
        const updatedId = newMapping[note.id];
        
        const variables = {};
        
        for (const key in note.variables) {
            if (key.endsWith("String")) {
                variables[key] = updateRawDependencies(note.variables[key]);
                const baseKey = key.slice(0, -6);
                variables[baseKey] = function() {
                    return new Function("module", "Fraction", "return " + variables[key] + ";")(this, Fraction);
                };
            } else if (key === 'color' || key === 'instrument') {
                variables[key] = note.variables[key];
            }
        }
        
        const newNote = new Note(updatedId, variables);
        newNote.module = this;
        
        if (parentRelationships[oldId] !== undefined) {
            const oldParentId = parentRelationships[oldId];
            newNote.parentId = newMapping[oldParentId] !== undefined ? newMapping[oldParentId] : 0;
        }
        
        newNotes[updatedId] = newNote;
    }
    
    this.notes = newNotes;
    this._evaluationCache = {};
    this._lastEvaluationTime = 0;
    this._dirtyNotes = new Set();
    this._dependenciesCache = new Map();
    this._dependentsCache = new Map();
    
    for (const id in this.notes) {
        this._dirtyNotes.add(Number(id));
    }
    
    invalidateModuleEndTimeCache();
  }
}