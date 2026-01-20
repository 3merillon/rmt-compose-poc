/**
 * DSL Error Classes
 *
 * User-friendly error types for the DSL parser and compiler.
 */

/**
 * Base class for DSL errors
 */
export class DSLError extends Error {
  /**
   * @param {string} message - Error message
   * @param {Object} [position] - Position info { line, column, start, end }
   */
  constructor(message, position = null) {
    super(message);
    this.name = 'DSLError';
    this.position = position;
  }

  /**
   * Get user-friendly error message with position
   * @returns {string}
   */
  get userMessage() {
    if (this.position) {
      return `${this.message} (at column ${this.position.column})`;
    }
    return this.message;
  }

  /**
   * Format error with source context
   * @param {string} source - Original source string
   * @returns {string}
   */
  formatWithContext(source) {
    if (!this.position || !source) {
      return this.userMessage;
    }

    const lines = [this.userMessage, '', source];

    // Add caret pointing to error position
    if (typeof this.position.column === 'number') {
      const caretPos = Math.max(0, this.position.column - 1);
      lines.push(' '.repeat(caretPos) + '^');
    }

    return lines.join('\n');
  }
}

/**
 * Lexer-specific errors (tokenization failures)
 */
export class DSLLexerError extends DSLError {
  /**
   * @param {string} message - Error message
   * @param {Object} position - Position info { line, column, start }
   */
  constructor(message, position) {
    super(message, position);
    this.name = 'DSLLexerError';
  }
}

/**
 * Parser-specific errors (grammar/syntax failures)
 */
export class DSLParseError extends DSLError {
  /**
   * @param {string} message - Error message
   * @param {Object} [token] - Token that caused the error
   */
  constructor(message, token = null) {
    const position = token ? {
      line: token.line,
      column: token.column,
      start: token.start,
      end: token.end
    } : null;
    super(message, position);
    this.name = 'DSLParseError';
    this.token = token;
  }
}

/**
 * Compiler-specific errors (semantic/code generation failures)
 */
export class DSLCompileError extends DSLError {
  /**
   * @param {string} message - Error message
   * @param {Object} [node] - AST node that caused the error
   */
  constructor(message, node = null) {
    super(message);
    this.name = 'DSLCompileError';
    this.node = node;
  }
}

/**
 * Create user-friendly error messages for common issues
 */
export const ErrorMessages = {
  /**
   * Unknown character in input
   * @param {string} char - The unknown character
   * @param {number} column - Column position
   * @returns {string}
   */
  unknownCharacter(char, column) {
    return `Unknown character '${char}' at column ${column}`;
  },

  /**
   * Unexpected token
   * @param {string} found - What was found
   * @param {string} [expected] - What was expected (optional)
   * @returns {string}
   */
  unexpectedToken(found, expected = null) {
    if (expected) {
      return `Unexpected '${found}', expected ${expected}`;
    }
    return `Unexpected '${found}'`;
  },

  /**
   * Missing closing bracket
   * @param {string} opener - The opening bracket
   * @returns {string}
   */
  unclosedBracket(opener) {
    const closers = { '(': ')', '[': ']' };
    return `Missing '${closers[opener] || ')'}' to close '${opener}'`;
  },

  /**
   * Invalid note ID
   * @param {string} value - The invalid value
   * @returns {string}
   */
  invalidNoteId(value) {
    return `Invalid note ID '${value}'. Note IDs must be non-negative integers`;
  },

  /**
   * Unknown property name
   * @param {string} name - The unknown property
   * @returns {string}
   */
  unknownProperty(name) {
    return `Unknown property '${name}'. Valid properties: f (frequency), t (startTime), d (duration), tempo, bpm, ml`;
  },

  /**
   * Unknown helper function
   * @param {string} name - The unknown function
   * @returns {string}
   */
  unknownHelper(name) {
    return `Unknown function '${name}'. Valid functions: tempo(), measure(), beat()`;
  },

  /**
   * Missing operator between expressions
   * @returns {string}
   */
  missingOperator() {
    return `Missing operator between expressions. Use +, -, *, /, or ^`;
  },

  /**
   * Division by zero in fraction
   * @returns {string}
   */
  divisionByZero() {
    return `Division by zero in fraction literal`;
  },

  /**
   * Empty expression
   * @returns {string}
   */
  emptyExpression() {
    return `Expression cannot be empty`;
  },

  /**
   * Self-reference detected
   * @param {number} noteId - The note referencing itself
   * @returns {string}
   */
  selfReference(noteId) {
    return `Note ${noteId} cannot reference itself (circular dependency)`;
  },

  /**
   * Missing property after dot
   * @returns {string}
   */
  missingProperty() {
    return `Expected property name after '.'`;
  },

  /**
   * Missing argument for helper function
   * @param {string} funcName - The function name
   * @returns {string}
   */
  missingHelperArgument(funcName) {
    return `Function '${funcName}()' requires a note reference argument`;
  },
};
