/**
 * DSL Constants
 *
 * Token types, property mappings, and helper function definitions
 * for the RMT Compose expression DSL.
 */

/**
 * Token types for the lexer
 */
export const TokenType = {
  // Literals
  NUMBER: 'NUMBER',           // 440, 3.14, -5

  // Operators
  PLUS: 'PLUS',               // +
  MINUS: 'MINUS',             // -
  STAR: 'STAR',               // *
  SLASH: 'SLASH',             // /
  CARET: 'CARET',             // ^

  // Delimiters
  LPAREN: 'LPAREN',           // (
  RPAREN: 'RPAREN',           // )
  LBRACKET: 'LBRACKET',       // [
  RBRACKET: 'RBRACKET',       // ]
  DOT: 'DOT',                 // .

  // Keywords
  BASE: 'BASE',               // base

  // Identifiers (properties and helpers)
  IDENTIFIER: 'IDENTIFIER',   // f, t, d, tempo, measure, beat, etc.

  // End of input
  EOF: 'EOF',
};

/**
 * Map short property names to canonical property names
 */
export const PropertyMap = {
  // Frequency shortcuts
  'f': 'frequency',
  'freq': 'frequency',
  'frequency': 'frequency',

  // Start time shortcuts
  't': 'startTime',
  's': 'startTime',
  'start': 'startTime',
  'startTime': 'startTime',

  // Duration shortcuts (d only, not l)
  'd': 'duration',
  'dur': 'duration',
  'duration': 'duration',

  // Tempo
  'tempo': 'tempo',

  // Beats per measure
  'bpm': 'beatsPerMeasure',
  'beatsPerMeasure': 'beatsPerMeasure',

  // Measure length
  'ml': 'measureLength',
  'measureLength': 'measureLength',
};

/**
 * Reverse map: canonical names to preferred short names (for decompiler)
 */
export const PropertyShortNames = {
  'frequency': 'f',
  'startTime': 't',
  'duration': 'd',
  'tempo': 'tempo',
  'beatsPerMeasure': 'bpm',
  'measureLength': 'ml',
};

/**
 * List of helper function names
 */
export const HelperFunctions = ['tempo', 'measure', 'beat'];

/**
 * Check if a string is a valid property name
 * @param {string} name - The name to check
 * @returns {boolean}
 */
export function isPropertyName(name) {
  return name in PropertyMap;
}

/**
 * Check if a string is a helper function name
 * @param {string} name - The name to check
 * @returns {boolean}
 */
export function isHelperFunction(name) {
  return HelperFunctions.includes(name);
}

/**
 * Get canonical property name from shorthand
 * @param {string} name - Short or full property name
 * @returns {string|null} - Canonical name or null if invalid
 */
export function getCanonicalPropertyName(name) {
  return PropertyMap[name] || null;
}

/**
 * Get short property name from canonical
 * @param {string} canonicalName - Canonical property name
 * @returns {string} - Short name (or canonical if no short exists)
 */
export function getShortPropertyName(canonicalName) {
  return PropertyShortNames[canonicalName] || canonicalName;
}

/**
 * Operator precedence levels (higher = binds tighter)
 */
export const Precedence = {
  LOWEST: 0,
  ADDITIVE: 1,      // + -
  MULTIPLICATIVE: 2, // * /
  UNARY: 3,         // - (negation)
  POWER: 4,         // ^
  ATOMIC: 5,        // literals, references - never need parentheses
};

/**
 * Operator symbols for decompilation
 */
export const OperatorSymbols = {
  ADD: '+',
  SUB: '-',
  MUL: '*',
  DIV: '/',
  POW: '^',
  NEG: '-',
};
