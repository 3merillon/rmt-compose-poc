/**
 * DSL Parser
 *
 * Recursive descent parser that converts tokens into an AST.
 *
 * Grammar:
 *   expression     -> additive
 *   additive       -> multiplicative (('+' | '-') multiplicative)*
 *   multiplicative -> unary (('*' | '/') unary)*
 *   unary          -> '-' unary | power
 *   power          -> primary ('^' unary)?
 *   primary        -> fraction | noteRef | helperCall | '(' expression ')' | number
 *   fraction       -> '(' number '/' number ')'
 *   noteRef        -> '[' number ']' '.' property | 'base' '.' property
 *   helperCall     -> HELPER '(' noteArg ')'
 *   noteArg        -> '[' number ']' | 'base'
 */

import { TokenType, PropertyMap, HelperFunctions, isPropertyName, isHelperFunction, getCanonicalPropertyName } from './constants.js';
import { DSLParseError, ErrorMessages } from './errors.js';
import {
  NodeType,
  createNumberLiteral,
  createFractionLiteral,
  createNoteReference,
  createBinaryOp,
  createUnaryOp,
  createHelperCall,
} from './ast.js';

/**
 * DSL Parser class
 */
export class DSLParser {
  /**
   * @param {Array} tokens - Array of tokens from lexer
   */
  constructor(tokens) {
    this.tokens = tokens;
    this.current = 0;
  }

  /**
   * Parse tokens into AST
   * @returns {Object} Root AST node
   */
  parse() {
    if (this.isAtEnd() || (this.tokens.length === 1 && this.peek().type === TokenType.EOF)) {
      throw new DSLParseError(ErrorMessages.emptyExpression());
    }

    const ast = this.expression();

    if (!this.isAtEnd()) {
      throw new DSLParseError(
        ErrorMessages.unexpectedToken(this.peek().value, 'end of expression'),
        this.peek()
      );
    }

    return ast;
  }

  // ─────────────────────────────────────────────────────────────────
  // Grammar rules
  // ─────────────────────────────────────────────────────────────────

  /**
   * expression -> additive
   */
  expression() {
    return this.additive();
  }

  /**
   * additive -> multiplicative (('+' | '-') multiplicative)*
   */
  additive() {
    let left = this.multiplicative();

    while (this.match(TokenType.PLUS, TokenType.MINUS)) {
      const operator = this.previous().type === TokenType.PLUS ? '+' : '-';
      const right = this.multiplicative();
      left = createBinaryOp(operator, left, right);
    }

    return left;
  }

  /**
   * multiplicative -> unary (('*' | '/') unary)*
   */
  multiplicative() {
    let left = this.unary();

    while (this.match(TokenType.STAR, TokenType.SLASH)) {
      const operator = this.previous().type === TokenType.STAR ? '*' : '/';
      const right = this.unary();
      left = createBinaryOp(operator, left, right);
    }

    return left;
  }

  /**
   * unary -> '-' unary | power
   */
  unary() {
    if (this.match(TokenType.MINUS)) {
      const operand = this.unary();
      return createUnaryOp('-', operand);
    }

    return this.power();
  }

  /**
   * power -> primary ('^' unary)?
   * Right-associative: a^b^c = a^(b^c)
   */
  power() {
    const base = this.primary();

    if (this.match(TokenType.CARET)) {
      const exponent = this.unary(); // Right-associative
      return createBinaryOp('^', base, exponent);
    }

    return base;
  }

  /**
   * primary -> fraction | noteRef | helperCall | '(' expression ')' | number
   */
  primary() {
    // Try fraction literal: (num/den)
    if (this.check(TokenType.LPAREN)) {
      return this.fractionOrGrouped();
    }

    // Try note reference: [id].prop
    if (this.check(TokenType.LBRACKET)) {
      return this.noteReference();
    }

    // Try base reference: base.prop
    if (this.check(TokenType.BASE)) {
      return this.baseReference();
    }

    // Try helper call: tempo(...), measure(...), beat(...)
    if (this.checkIdentifierIsHelper()) {
      return this.helperCall();
    }

    // Number literal
    if (this.match(TokenType.NUMBER)) {
      return this.numberLiteral(this.previous());
    }

    throw new DSLParseError(
      ErrorMessages.unexpectedToken(this.peek().value, 'expression'),
      this.peek()
    );
  }

  /**
   * Parse either a fraction (1/2) or grouped expression (a + b)
   */
  fractionOrGrouped() {
    const lparen = this.advance(); // consume '('

    // Look ahead to see if this is a fraction: (number / number)
    if (this.check(TokenType.NUMBER) || this.check(TokenType.MINUS)) {
      const savedPos = this.current;

      try {
        // Try to parse as fraction
        const numerator = this.parseSignedNumber();
        if (this.match(TokenType.SLASH)) {
          const denominator = this.parseSignedNumber();
          this.consume(TokenType.RPAREN, ErrorMessages.unclosedBracket('('));

          if (denominator === 0) {
            throw new DSLParseError(ErrorMessages.divisionByZero(), lparen);
          }

          return createFractionLiteral(numerator, denominator);
        }
      } catch (e) {
        // Not a fraction, restore and parse as grouped expression
      }

      // Restore position and parse as grouped expression
      this.current = savedPos;
    }

    // Parse as grouped expression
    const expr = this.expression();
    this.consume(TokenType.RPAREN, ErrorMessages.unclosedBracket('('));
    return expr;
  }

  /**
   * Parse a signed number (for fractions)
   * @returns {number}
   */
  parseSignedNumber() {
    let sign = 1;
    if (this.match(TokenType.MINUS)) {
      sign = -1;
    }

    if (!this.check(TokenType.NUMBER)) {
      throw new DSLParseError(
        ErrorMessages.unexpectedToken(this.peek().value, 'number'),
        this.peek()
      );
    }

    const token = this.advance();
    const value = parseFloat(token.value);

    if (!Number.isInteger(value)) {
      throw new DSLParseError(
        `Fraction components must be integers, got '${token.value}'`,
        token
      );
    }

    return sign * value;
  }

  /**
   * Parse note reference: [id].property
   */
  noteReference() {
    const lbracket = this.advance(); // consume '['

    if (!this.check(TokenType.NUMBER)) {
      throw new DSLParseError(
        ErrorMessages.invalidNoteId(this.peek().value),
        this.peek()
      );
    }

    const idToken = this.advance();
    const noteId = parseInt(idToken.value, 10);

    if (!Number.isInteger(noteId) || noteId < 0) {
      throw new DSLParseError(
        ErrorMessages.invalidNoteId(idToken.value),
        idToken
      );
    }

    this.consume(TokenType.RBRACKET, ErrorMessages.unclosedBracket('['));
    this.consume(TokenType.DOT, ErrorMessages.missingProperty());

    const property = this.parsePropertyName();

    // Note: [0] is treated as baseNote
    if (noteId === 0) {
      return createNoteReference('base', property);
    }

    return createNoteReference(noteId, property);
  }

  /**
   * Parse base reference: base.property
   */
  baseReference() {
    this.advance(); // consume 'base'
    this.consume(TokenType.DOT, ErrorMessages.missingProperty());
    const property = this.parsePropertyName();
    return createNoteReference('base', property);
  }

  /**
   * Parse a property name identifier
   * @returns {string} Canonical property name
   */
  parsePropertyName() {
    if (!this.check(TokenType.IDENTIFIER)) {
      throw new DSLParseError(
        ErrorMessages.missingProperty(),
        this.peek()
      );
    }

    const token = this.advance();
    const canonical = getCanonicalPropertyName(token.value);

    if (!canonical) {
      throw new DSLParseError(
        ErrorMessages.unknownProperty(token.value),
        token
      );
    }

    return canonical;
  }

  /**
   * Parse helper call: tempo([id]), measure(base), beat([id])
   */
  helperCall() {
    const funcToken = this.advance(); // consume function name
    const funcName = funcToken.value;

    this.consume(TokenType.LPAREN, `Expected '(' after '${funcName}'`);

    const noteArg = this.parseNoteArg();

    this.consume(TokenType.RPAREN, ErrorMessages.unclosedBracket('('));

    return createHelperCall(funcName, noteArg);
  }

  /**
   * Parse note argument for helper: [id] or base
   * @returns {number|'base'}
   */
  parseNoteArg() {
    if (this.match(TokenType.BASE)) {
      return 'base';
    }

    if (this.match(TokenType.LBRACKET)) {
      if (!this.check(TokenType.NUMBER)) {
        throw new DSLParseError(
          ErrorMessages.invalidNoteId(this.peek().value),
          this.peek()
        );
      }

      const idToken = this.advance();
      const noteId = parseInt(idToken.value, 10);

      if (!Number.isInteger(noteId) || noteId < 0) {
        throw new DSLParseError(
          ErrorMessages.invalidNoteId(idToken.value),
          idToken
        );
      }

      this.consume(TokenType.RBRACKET, ErrorMessages.unclosedBracket('['));

      // [0] is treated as base
      return noteId === 0 ? 'base' : noteId;
    }

    throw new DSLParseError(
      ErrorMessages.missingHelperArgument(this.previous().value),
      this.peek()
    );
  }

  /**
   * Parse a number literal token into AST node
   * @param {Object} token - NUMBER token
   * @returns {Object} AST node
   */
  numberLiteral(token) {
    const value = parseFloat(token.value);
    const { numerator, denominator } = this.decimalToFraction(value);
    return createNumberLiteral(value, numerator, denominator);
  }

  /**
   * Convert decimal to fraction
   * @param {number} value
   * @returns {{numerator: number, denominator: number}}
   */
  decimalToFraction(value) {
    if (Number.isInteger(value)) {
      return { numerator: value, denominator: 1 };
    }

    // Handle common decimal fractions
    const tolerance = 1e-10;
    const maxDen = 10000;

    const simpleTests = [
      [0.25, 1, 4], [0.5, 1, 2], [0.75, 3, 4],
      [0.125, 1, 8], [0.375, 3, 8], [0.625, 5, 8], [0.875, 7, 8],
      [0.2, 1, 5], [0.4, 2, 5], [0.6, 3, 5], [0.8, 4, 5],
      [0.333333, 1, 3], [0.666666, 2, 3],
      [0.1666666, 1, 6], [0.8333333, 5, 6],
    ];

    const absVal = Math.abs(value);
    const sign = value < 0 ? -1 : 1;

    for (const [dec, n, d] of simpleTests) {
      if (Math.abs(absVal - dec) < tolerance) {
        return { numerator: sign * n, denominator: d };
      }
    }

    // Use approximation for other decimals
    let bestNum = Math.round(value), bestDen = 1;
    let bestErr = Math.abs(value - bestNum);

    for (let d = 1; d <= maxDen; d++) {
      const n = Math.round(value * d);
      const err = Math.abs(value - n / d);
      if (err < bestErr) {
        bestNum = n;
        bestDen = d;
        bestErr = err;
        if (err < tolerance) break;
      }
    }

    return { numerator: bestNum, denominator: bestDen };
  }

  // ─────────────────────────────────────────────────────────────────
  // Helper methods
  // ─────────────────────────────────────────────────────────────────

  /**
   * Check if current token is of given type(s)
   */
  check(type) {
    if (this.isAtEnd()) return false;
    return this.peek().type === type;
  }

  /**
   * Check if current identifier is a helper function
   */
  checkIdentifierIsHelper() {
    if (!this.check(TokenType.IDENTIFIER)) return false;
    return isHelperFunction(this.peek().value);
  }

  /**
   * Advance if current token matches any of the given types
   */
  match(...types) {
    for (const type of types) {
      if (this.check(type)) {
        this.advance();
        return true;
      }
    }
    return false;
  }

  /**
   * Consume expected token or throw error
   */
  consume(type, errorMessage) {
    if (this.check(type)) {
      return this.advance();
    }
    throw new DSLParseError(errorMessage, this.peek());
  }

  /**
   * Get current token
   */
  peek() {
    return this.tokens[this.current];
  }

  /**
   * Get previous token
   */
  previous() {
    return this.tokens[this.current - 1];
  }

  /**
   * Advance to next token
   */
  advance() {
    if (!this.isAtEnd()) this.current++;
    return this.previous();
  }

  /**
   * Check if at end of tokens
   */
  isAtEnd() {
    return this.peek().type === TokenType.EOF;
  }
}

/**
 * Parse a DSL source string into AST
 * @param {Array} tokens - Tokens from lexer
 * @returns {Object} Root AST node
 */
export function parse(tokens) {
  const parser = new DSLParser(tokens);
  return parser.parse();
}
