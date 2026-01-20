/**
 * DSL Lexer (Tokenizer)
 *
 * Converts DSL source string into a stream of tokens.
 */

import { TokenType } from './constants.js';
import { DSLLexerError, ErrorMessages } from './errors.js';

/**
 * Create a token
 * @param {string} type - Token type from TokenType
 * @param {string} value - Raw string value
 * @param {number} start - Start position in source
 * @param {number} end - End position in source
 * @param {number} line - Line number (1-indexed)
 * @param {number} column - Column number (1-indexed)
 * @returns {Object} Token object
 */
function createToken(type, value, start, end, line, column) {
  return { type, value, start, end, line, column };
}

/**
 * DSL Lexer class
 */
export class DSLLexer {
  /**
   * @param {string} source - Source string to tokenize
   */
  constructor(source) {
    this.source = source;
    this.pos = 0;
    this.line = 1;
    this.column = 1;
    this.tokens = [];
  }

  /**
   * Tokenize the source and return all tokens
   * @returns {Array} Array of tokens
   */
  tokenize() {
    this.tokens = [];

    while (!this.isAtEnd()) {
      this.skipWhitespace();
      if (this.isAtEnd()) break;

      const token = this.scanToken();
      if (token) {
        this.tokens.push(token);
      }
    }

    // Add EOF token
    this.tokens.push(createToken(
      TokenType.EOF,
      '',
      this.pos,
      this.pos,
      this.line,
      this.column
    ));

    return this.tokens;
  }

  /**
   * Check if at end of input
   * @returns {boolean}
   */
  isAtEnd() {
    return this.pos >= this.source.length;
  }

  /**
   * Get current character
   * @returns {string}
   */
  peek() {
    return this.source[this.pos] || '\0';
  }

  /**
   * Get next character without advancing
   * @returns {string}
   */
  peekNext() {
    return this.source[this.pos + 1] || '\0';
  }

  /**
   * Advance and return current character
   * @returns {string}
   */
  advance() {
    const char = this.source[this.pos++];
    if (char === '\n') {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    return char;
  }

  /**
   * Skip whitespace characters
   */
  skipWhitespace() {
    while (!this.isAtEnd()) {
      const char = this.peek();
      if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
        this.advance();
      } else if (char === '#') {
        // Comment: skip to end of line
        while (!this.isAtEnd() && this.peek() !== '\n') {
          this.advance();
        }
      } else {
        break;
      }
    }
  }

  /**
   * Scan a single token
   * @returns {Object} Token
   */
  scanToken() {
    const start = this.pos;
    const startLine = this.line;
    const startColumn = this.column;
    const char = this.advance();

    switch (char) {
      case '+':
        return createToken(TokenType.PLUS, '+', start, this.pos, startLine, startColumn);
      case '-':
        // Could be minus operator or negative number
        // We'll handle negative numbers in the parser for simplicity
        return createToken(TokenType.MINUS, '-', start, this.pos, startLine, startColumn);
      case '*':
        return createToken(TokenType.STAR, '*', start, this.pos, startLine, startColumn);
      case '/':
        return createToken(TokenType.SLASH, '/', start, this.pos, startLine, startColumn);
      case '^':
        return createToken(TokenType.CARET, '^', start, this.pos, startLine, startColumn);
      case '(':
        return createToken(TokenType.LPAREN, '(', start, this.pos, startLine, startColumn);
      case ')':
        return createToken(TokenType.RPAREN, ')', start, this.pos, startLine, startColumn);
      case '[':
        return createToken(TokenType.LBRACKET, '[', start, this.pos, startLine, startColumn);
      case ']':
        return createToken(TokenType.RBRACKET, ']', start, this.pos, startLine, startColumn);
      case '.':
        return createToken(TokenType.DOT, '.', start, this.pos, startLine, startColumn);

      default:
        // Number
        if (this.isDigit(char)) {
          return this.scanNumber(start, startLine, startColumn, char);
        }

        // Identifier or keyword
        if (this.isAlpha(char)) {
          return this.scanIdentifier(start, startLine, startColumn, char);
        }

        throw new DSLLexerError(
          ErrorMessages.unknownCharacter(char, startColumn),
          { line: startLine, column: startColumn, start }
        );
    }
  }

  /**
   * Scan a number token
   * @param {number} start - Start position
   * @param {number} startLine - Start line
   * @param {number} startColumn - Start column
   * @param {string} firstChar - First character already consumed
   * @returns {Object} Token
   */
  scanNumber(start, startLine, startColumn, firstChar) {
    let value = firstChar;

    // Integer part
    while (!this.isAtEnd() && this.isDigit(this.peek())) {
      value += this.advance();
    }

    // Decimal part
    if (this.peek() === '.' && this.isDigit(this.peekNext())) {
      value += this.advance(); // consume '.'
      while (!this.isAtEnd() && this.isDigit(this.peek())) {
        value += this.advance();
      }
    }

    return createToken(TokenType.NUMBER, value, start, this.pos, startLine, startColumn);
  }

  /**
   * Scan an identifier or keyword
   * @param {number} start - Start position
   * @param {number} startLine - Start line
   * @param {number} startColumn - Start column
   * @param {string} firstChar - First character already consumed
   * @returns {Object} Token
   */
  scanIdentifier(start, startLine, startColumn, firstChar) {
    let value = firstChar;

    while (!this.isAtEnd() && this.isAlphaNumeric(this.peek())) {
      value += this.advance();
    }

    // Check for keywords
    if (value === 'base') {
      return createToken(TokenType.BASE, value, start, this.pos, startLine, startColumn);
    }

    return createToken(TokenType.IDENTIFIER, value, start, this.pos, startLine, startColumn);
  }

  /**
   * Check if character is a digit
   * @param {string} char
   * @returns {boolean}
   */
  isDigit(char) {
    return char >= '0' && char <= '9';
  }

  /**
   * Check if character is alphabetic
   * @param {string} char
   * @returns {boolean}
   */
  isAlpha(char) {
    return (char >= 'a' && char <= 'z') ||
           (char >= 'A' && char <= 'Z') ||
           char === '_';
  }

  /**
   * Check if character is alphanumeric
   * @param {string} char
   * @returns {boolean}
   */
  isAlphaNumeric(char) {
    return this.isAlpha(char) || this.isDigit(char);
  }
}

/**
 * Tokenize a DSL source string
 * @param {string} source - Source string
 * @returns {Array} Array of tokens
 */
export function tokenize(source) {
  const lexer = new DSLLexer(source);
  return lexer.tokenize();
}
