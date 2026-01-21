/**
 * AST Node Types and Factory Functions
 *
 * Defines the Abstract Syntax Tree structure for the DSL.
 */

/**
 * AST Node Types
 */
export const NodeType = {
  // Literals
  NumberLiteral: 'NumberLiteral',       // 440, -5, 3.14
  FractionLiteral: 'FractionLiteral',   // (3/2), (1/12)

  // References
  NoteReference: 'NoteReference',       // [246].f, base.t

  // Operations
  BinaryOp: 'BinaryOp',                 // +, -, *, /, ^
  UnaryOp: 'UnaryOp',                   // - (negation)

  // Helper calls
  HelperCall: 'HelperCall',             // tempo([246]), measure(base), beat([5])
};

/**
 * Create a number literal node
 * @param {number} value - The numeric value
 * @param {number} numerator - Fraction numerator
 * @param {number} denominator - Fraction denominator
 * @returns {Object} AST node
 */
export function createNumberLiteral(value, numerator, denominator) {
  return {
    type: NodeType.NumberLiteral,
    value,
    numerator,
    denominator,
  };
}

/**
 * Create a fraction literal node
 * @param {number} numerator - The numerator
 * @param {number} denominator - The denominator
 * @returns {Object} AST node
 */
export function createFractionLiteral(numerator, denominator) {
  return {
    type: NodeType.FractionLiteral,
    numerator,
    denominator,
  };
}

/**
 * Create a note reference node
 * @param {number|'base'} noteId - Note ID or 'base' for baseNote
 * @param {string} property - Canonical property name
 * @returns {Object} AST node
 */
export function createNoteReference(noteId, property) {
  return {
    type: NodeType.NoteReference,
    noteId,
    property,
  };
}

/**
 * Create a binary operation node
 * @param {string} operator - '+', '-', '*', '/', '^'
 * @param {Object} left - Left operand AST node
 * @param {Object} right - Right operand AST node
 * @returns {Object} AST node
 */
export function createBinaryOp(operator, left, right) {
  return {
    type: NodeType.BinaryOp,
    operator,
    left,
    right,
  };
}

/**
 * Create a unary operation node
 * @param {string} operator - '-' (only negation for now)
 * @param {Object} operand - Operand AST node
 * @returns {Object} AST node
 */
export function createUnaryOp(operator, operand) {
  return {
    type: NodeType.UnaryOp,
    operator,
    operand,
  };
}

/**
 * Create a helper call node
 * @param {string} helper - 'tempo', 'measure', 'beat'
 * @param {number|'base'} noteArg - Note ID or 'base'
 * @returns {Object} AST node
 */
export function createHelperCall(helper, noteArg) {
  return {
    type: NodeType.HelperCall,
    helper,
    noteArg,
  };
}

/**
 * Check if a node is a specific type
 * @param {Object} node - AST node
 * @param {string} type - Node type to check
 * @returns {boolean}
 */
export function isNodeType(node, type) {
  return node && node.type === type;
}

/**
 * Check if a node is a literal (number or fraction)
 * @param {Object} node - AST node
 * @returns {boolean}
 */
export function isLiteral(node) {
  return isNodeType(node, NodeType.NumberLiteral) ||
         isNodeType(node, NodeType.FractionLiteral);
}

/**
 * Check if a node is a reference
 * @param {Object} node - AST node
 * @returns {boolean}
 */
export function isReference(node) {
  return isNodeType(node, NodeType.NoteReference);
}

/**
 * Check if a node is an operation
 * @param {Object} node - AST node
 * @returns {boolean}
 */
export function isOperation(node) {
  return isNodeType(node, NodeType.BinaryOp) ||
         isNodeType(node, NodeType.UnaryOp);
}

/**
 * Check if node references baseNote
 * @param {Object} node - AST node
 * @returns {boolean}
 */
export function referencesBase(node) {
  if (!node) return false;

  switch (node.type) {
    case NodeType.NoteReference:
      return node.noteId === 'base' || node.noteId === 0;

    case NodeType.HelperCall:
      return node.noteArg === 'base' || node.noteArg === 0;

    case NodeType.BinaryOp:
      return referencesBase(node.left) || referencesBase(node.right);

    case NodeType.UnaryOp:
      return referencesBase(node.operand);

    default:
      return false;
  }
}

/**
 * Collect all note IDs referenced in an AST
 * @param {Object} node - AST node
 * @param {Set} [deps] - Set to collect dependencies into
 * @returns {Set<number>} Set of note IDs (excluding 'base'/0)
 */
export function collectDependencies(node, deps = new Set()) {
  if (!node) return deps;

  switch (node.type) {
    case NodeType.NoteReference:
      if (typeof node.noteId === 'number' && node.noteId !== 0) {
        deps.add(node.noteId);
      }
      break;

    case NodeType.HelperCall:
      if (typeof node.noteArg === 'number' && node.noteArg !== 0) {
        deps.add(node.noteArg);
      }
      break;

    case NodeType.BinaryOp:
      collectDependencies(node.left, deps);
      collectDependencies(node.right, deps);
      break;

    case NodeType.UnaryOp:
      collectDependencies(node.operand, deps);
      break;
  }

  return deps;
}

/**
 * Pretty-print an AST node (for debugging)
 * @param {Object} node - AST node
 * @param {number} [indent] - Indentation level
 * @returns {string}
 */
export function printAST(node, indent = 0) {
  const pad = '  '.repeat(indent);

  if (!node) return `${pad}(null)`;

  switch (node.type) {
    case NodeType.NumberLiteral:
      return `${pad}Number(${node.numerator}/${node.denominator})`;

    case NodeType.FractionLiteral:
      return `${pad}Fraction(${node.numerator}/${node.denominator})`;

    case NodeType.NoteReference:
      return `${pad}Ref([${node.noteId}].${node.property})`;

    case NodeType.HelperCall:
      return `${pad}Helper(${node.helper}([${node.noteArg}]))`;

    case NodeType.BinaryOp:
      return [
        `${pad}BinaryOp(${node.operator})`,
        printAST(node.left, indent + 1),
        printAST(node.right, indent + 1),
      ].join('\n');

    case NodeType.UnaryOp:
      return [
        `${pad}UnaryOp(${node.operator})`,
        printAST(node.operand, indent + 1),
      ].join('\n');

    default:
      return `${pad}Unknown(${node.type})`;
  }
}
