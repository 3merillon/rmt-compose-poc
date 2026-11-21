import { TokenType } from './constants.js';
import { tokenize } from './lexer.js';

/**
 * Visit references in compiled DSL in source order. A numeric replacement
 * edits only the ID, retaining whitespace and comments. A string replaces
 * the whole reference (e.g. a drop at a target's end). Null rejects a source
 * whose reference cannot be carried across.
 */
export function rewriteNoteReferences(source, replace) {
  if (!source || (!source.includes('[') && !source.includes('base'))) return source;

  const tokens = tokenize(source);
  let output = '';
  let cursor = 0;
  for (let i = 0; i < tokens.length; i++) {
    const first = tokens[i];
    if (first.type !== TokenType.LBRACKET && first.type !== TokenType.BASE) continue;
    const bracketed = first.type === TokenType.LBRACKET;
    const idToken = bracketed ? tokens[i + 1] : null;
    const id = bracketed ? parseInt(idToken.value, 10) : 0;
    const property = tokens[i + (bracketed ? 4 : 2)];
    const original = source.slice(first.start, property.end);
    const replacement = replace(id, property.value, original);
    if (replacement == null) return null;
    if (typeof replacement === 'number') {
      if (replacement !== id) {
        const target = idToken ?? first;
        output += source.slice(cursor, target.start) + (bracketed ? replacement : `[${replacement}]`);
        cursor = target.end;
      }
    } else if (replacement !== original) {
      output += source.slice(cursor, first.start) + replacement;
      cursor = property.end;
    }
  }
  return cursor ? output + source.slice(cursor) : source;
}

export function remapNoteIds(source, lookup) {
  return source?.includes('[') ? rewriteNoteReferences(source, lookup) : source;
}
