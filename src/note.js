export class Note {
    constructor(id, variables = {}) {
        this.id = id;
        this.variables = {};
        this.module = null;
        this.lastModifiedTime = Date.now();
        
        Object.entries(variables).forEach(([key, value]) => {
            if (typeof value === 'function') {
                this.variables[key] = value;
            } else if (key.endsWith('String')) {
                this.variables[key] = value;
            } else if (key === 'color' || key === 'instrument') {
                this.variables[key] = value;
            } else {
                this.variables[key] = () => value;
            }
        });
        
        if (id === 0 && !variables.instrument) {
            this.variables.instrument = 'sine-wave';
        }
    }

    setVariable(name, value) {
        this.variables[name] = value;
        this.lastModifiedTime = Date.now();
        
        if (this.module && typeof this.module.markNoteDirty === 'function') {
            this.module.markNoteDirty(this.id);
        }
        
        if (typeof window !== 'undefined' && window.invalidateModuleEndTimeCache) {
            window.invalidateModuleEndTimeCache();
        }
    }

    getVariable(name) {
        if (!this.variables[name]) return null;
        
        if (typeof this.variables[name] === 'function') {
            return this.variables[name]();
        }
        
        if (name.endsWith('String')) {
            return this.variables[name];
        }
        
        return this.variables[name];
    }

    getAllVariables() {
        const evaluatedVariables = {};
        for (const name of Object.keys(this.variables)) {
            if (name.endsWith('String')) {
                evaluatedVariables[name] = this.variables[name];
            } else {
                evaluatedVariables[name] = this.getVariable(name);
            }
        }
        return evaluatedVariables;
    }
}