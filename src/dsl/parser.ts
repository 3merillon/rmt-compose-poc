import type { AstNode, SignedLiteral } from './ast.ts';
import type { Token, TokenKind } from './lexer.ts';
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
 *   primary        -> fraction | noteRef | '(' expression ')' | number
 *   fraction       -> '(' number '/' number ')'
 *   noteRef        -> '[' number ']' '.' property | 'base' '.' property
 *
 * There are no functions. The old time helpers beat(), tempo() and measure()
 * are refused with a message saying what to write instead.
 */

import { TokenType, RetiredTimeFunctions, RetiredTimeProperties, getCanonicalPropertyName } from './constants.ts';
import { DSLParseError, ErrorMessages } from './errors.ts';
import { decimalStringToBigFraction } from '../utils/fraction-num.ts';
import { MAX_NOTE_ID } from '../binary-note.ts';
import {
  NodeType,
  createNumberLiteral,
  createFractionLiteral,
  createApproximate,
  createNoteReference,
  createBinaryOp,
  createUnaryOp,
} from './ast.ts';

/**
 * DSL Parser class
 */
export class DSLParser {
  declare tokens: Token[];
  declare current: number;
  /**
   * @param {Array} tokens - Array of tokens from lexer
   */
  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.current = 0;
  }

  /**
   * Parse tokens into AST
   * @returns {Object} Root AST node
   */
  parse(): AstNode {
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
  expression(): AstNode {
    return this.additive();
  }

  /**
   * additive -> multiplicative (('+' | '-') multiplicative)*
   */
  additive(): AstNode {
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
  multiplicative(): AstNode {
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
  unary(): AstNode {
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
  power(): AstNode {
    const base = this.primary();

    if (this.match(TokenType.CARET)) {
      const exponent = this.unary(); // Right-associative
      return createBinaryOp('^', base, exponent);
    }

    return base;
  }

  /**
   * primary -> fraction | noteRef | '(' expression ')' | number
   */
  primary(): AstNode {
    // Try fraction literal: (num/den)
    if (this.check(TokenType.LPAREN)) {
      return this.fractionOrGrouped();
    }

    // An approximate number: ~261.63, ~-3, ~(3/2)
    if (this.check(TokenType.TILDE)) {
      return this.approximate();
    }

    // Try note reference: [id].prop
    if (this.check(TokenType.LBRACKET)) {
      return this.noteReference();
    }

    // Try base reference: base.prop
    if (this.check(TokenType.BASE)) {
      return this.baseReference();
    }

    // beat(...), tempo(...), measure(...): the old time model
    if (this.check(TokenType.IDENTIFIER) && RetiredTimeFunctions.includes(this.peek().value)) {
      throw new DSLParseError(ErrorMessages.retiredTimeFunction(this.peek().value), this.peek());
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
   * `~` before a number: the number is approximate (a measurement, a rounded
   * value). It marks a literal only — `~261.63`, `~-3`, `~(3/2)` — never an
   * expression: what is computed from it is approximate by propagation.
   */
  approximate() {
    const tilde = this.advance(); // consume '~'
    let literal = null;
    if (this.check(TokenType.MINUS)) {
      this.advance();
      if (this.check(TokenType.NUMBER)) literal = createUnaryOp('-', this.numberLiteral(this.advance()));
    } else if (this.check(TokenType.NUMBER)) {
      literal = this.numberLiteral(this.advance());
    } else if (this.check(TokenType.LPAREN)) {
      const node = this.fractionOrGrouped();
      const isLit = (n: AstNode): n is SignedLiteral => n && (n.type === NodeType.NumberLiteral || n.type === NodeType.FractionLiteral ||
        (n.type === NodeType.UnaryOp && n.operator === '-' && isLit(n.operand)));
      if (isLit(node)) literal = node;
    }
    if (!literal) {
      throw new DSLParseError(ErrorMessages.approximateNeedsNumber(), tilde);
    }
    return createApproximate(literal);
  }

  /**
   * Parse either a fraction (1/2) or grouped expression (a + b)
   */
  fractionOrGrouped(): AstNode {
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

          if (denominator === 0n) {
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
   * @returns {bigint}
   */
  parseSignedNumber() {
    let negative = false;
    if (this.match(TokenType.MINUS)) {
      negative = true;
    }

    if (!this.check(TokenType.NUMBER)) {
      throw new DSLParseError(
        ErrorMessages.unexpectedToken(this.peek().value, 'number'),
        this.peek()
      );
    }

    const token = this.advance();

    if (token.value.includes('.')) {
      throw new DSLParseError(
        `Fraction components must be integers, got '${token.value}'`,
        token
      );
    }

    const value = BigInt(token.value);
    return negative ? -value : value;
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

    // MAX_NOTE_ID (src/binary-note.js), the largest id a note can have
    if (!Number.isInteger(noteId) || noteId < 0 || noteId > MAX_NOTE_ID) {
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

    if (!canonical && RetiredTimeProperties.includes(token.value)) {
      throw new DSLParseError(ErrorMessages.retiredTimeProperty(token.value), token);
    }
    if (!canonical) {
      throw new DSLParseError(
        ErrorMessages.unknownProperty(token.value),
        token
      );
    }

    return canonical;
  }

  /**
   * Parse a number literal token into AST node.
   * Exact at any magnitude: integers keep every digit, decimals become the
   * exact fraction they spell ('0.333333' is 333333/1000000, not 1/3).
   * @param {Object} token - NUMBER token
   * @returns {Object} AST node
   */
  numberLiteral(token: Token) {
    const frac = decimalStringToBigFraction(token.value);
    if (!frac) {
      throw new DSLParseError(
        ErrorMessages.unexpectedToken(token.value, 'number'),
        token
      );
    }
    return createNumberLiteral(parseFloat(token.value), frac.num, frac.den);
  }

  // ─────────────────────────────────────────────────────────────────
  // Helper methods
  // ─────────────────────────────────────────────────────────────────

  /**
   * Check if current token is of given type(s)
   */
  check(type: TokenKind) {
    if (this.isAtEnd()) return false;
    return this.peek().type === type;
  }

  /**
   * Advance if current token matches any of the given types
   */
  match(...types: TokenKind[]) {
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
  consume(type: TokenKind, errorMessage: string) {
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
export function parse(tokens: Token[]) {
  const parser = new DSLParser(tokens);
  return parser.parse();
}
