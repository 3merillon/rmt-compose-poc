import { validateSettings, defaultSettings } from '../src/settings/settings-schema.js';
let s = defaultSettings();
s.arrows.up = { n: 3, d: 2, label: null };        // user picks a fifth
s = validateSettings(s);
console.log('after picking 3/2 ->', JSON.stringify(s.arrows));
s.arrows.up = { n: 17, d: 1, label: null };        // user types 17/1 (out of range)
s = validateSettings(s);
console.log('after typing 17/1 ->', JSON.stringify(s.arrows));
