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
class Note {
    constructor(id, variables = {}) {
        this.id = id;
        this.variables = {};
        
        // Process each variable
        Object.entries(variables).forEach(([key, value]) => {
            if (typeof value === 'function') {
                // Store functions directly
                this.variables[key] = value;
            } else if (key.endsWith('String')) {
                // Store string representations directly
                this.variables[key] = value;
            } else if (key === 'color') {
                // Store color as a direct value
                this.variables[key] = value;
            } else {
                // Wrap other values in a function
                this.variables[key] = () => value;
            }
        });
    }

    setVariable(name, value) {
        // Store the value
        this.variables[name] = value;
    }

    getVariable(name) {
        if (!this.variables[name]) {
            return null;
        }
        
        // If it's a function, execute it
        if (typeof this.variables[name] === 'function') {
            return this.variables[name]();
        }
        
        // If it's a string variable (ends with 'String'), return it directly
        if (name.endsWith('String')) {
            return this.variables[name];
        }
        
        // For other types, return the value directly
        return this.variables[name];
    }

    getAllVariables() {
        const evaluatedVariables = {};
        for (const name of Object.keys(this.variables)) {
            // For raw string variables, store them directly
            if (name.endsWith('String')) {
                evaluatedVariables[name] = this.variables[name];
            } else {
                // For function variables or other types, get their evaluated value
                evaluatedVariables[name] = this.getVariable(name);
            }
        }
        return evaluatedVariables;
    }
}