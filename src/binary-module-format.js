/**
 * Binary Module File Format (.rmtb)
 *
 * Serializes/deserializes a Module to/from a compact binary format
 * that directly stores the BinaryExpression bytecodes.
 *
 * Format:
 *   Header: "RMT\x01" (4 bytes magic) + uint8 version (1)
 *   BaseNote: serialized note (id=0)
 *   NoteCount: uint16
 *   Notes: serialized notes
 *
 * Each note:
 *   noteId: uint16
 *   varCount: uint8 (number of expression variables present)
 *   For each variable:
 *     varIndex: uint8 (0-5)
 *     bytecodeLen: uint16
 *     bytecode: Uint8Array[bytecodeLen]
 *     sourceTextLen: uint16
 *     sourceText: UTF-8 bytes[sourceTextLen]
 *   colorLen: uint8 (0 if none)
 *   color: UTF-8 bytes[colorLen]
 *   instrumentLen: uint8 (0 if none)
 *   instrument: UTF-8 bytes[instrumentLen]
 */

import { Module } from './module.js';
import { Note } from './note.js';
import { BinaryExpression } from './binary-note.js';
import { validateColorInput, validateInstrumentName } from './utils/html-escape.js';

const MAGIC = new Uint8Array([0x52, 0x4D, 0x54, 0x01]); // "RMT\x01"
const FORMAT_VERSION = 1;

/** Bounds-checking helper: throws if not enough bytes remain in the buffer. */
function ensureBytes(data, offset, needed) {
  if (offset + needed > data.length) {
    throw new Error('.rmtb truncated: need ' + needed + ' bytes at offset ' + offset + ', have ' + (data.length - offset));
  }
}

const VAR_NAMES = ['startTime', 'duration', 'frequency', 'tempo', 'beatsPerMeasure', 'measureLength'];

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Serialize a Module to an ArrayBuffer (.rmtb format)
 * @param {Module} module
 * @returns {ArrayBuffer}
 */
export function serializeBinaryModule(module) {
  const chunks = [];
  let totalSize = 0;

  function pushBytes(bytes) {
    chunks.push(bytes);
    totalSize += bytes.length;
  }

  // Header
  pushBytes(MAGIC);
  pushBytes(new Uint8Array([FORMAT_VERSION]));

  // Serialize base note (id=0)
  serializeNote(module.baseNote, pushBytes);

  // Count non-base notes
  const noteIds = Object.keys(module.notes)
    .map(Number)
    .filter(id => id !== 0)
    .sort((a, b) => a - b);

  const countBuf = new Uint8Array(2);
  new DataView(countBuf.buffer).setUint16(0, noteIds.length, false);
  pushBytes(countBuf);

  // Serialize each note
  for (const id of noteIds) {
    serializeNote(module.notes[id], pushBytes);
  }

  // Combine all chunks
  const result = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result.buffer;
}

function serializeNote(note, pushBytes) {
  // Note ID
  const idBuf = new Uint8Array(2);
  new DataView(idBuf.buffer).setUint16(0, note.id, false);
  pushBytes(idBuf);

  // Collect non-empty expressions
  const vars = [];
  for (let i = 0; i < VAR_NAMES.length; i++) {
    const expr = note.getExpression(VAR_NAMES[i]);
    if (expr && !expr.isEmpty()) {
      vars.push({ index: i, expr });
    }
  }

  // Variable count
  pushBytes(new Uint8Array([vars.length]));

  // Each variable
  for (const { index, expr } of vars) {
    pushBytes(new Uint8Array([index]));

    // Bytecode length + data
    const bytecode = expr.bytecode.subarray(0, expr.length);
    const lenBuf = new Uint8Array(2);
    new DataView(lenBuf.buffer).setUint16(0, bytecode.length, false);
    pushBytes(lenBuf);
    pushBytes(bytecode);

    // Source text (for round-trip DSL preservation)
    const sourceBytes = encoder.encode(expr.sourceText || '');
    const srcLenBuf = new Uint8Array(2);
    new DataView(srcLenBuf.buffer).setUint16(0, sourceBytes.length, false);
    pushBytes(srcLenBuf);
    pushBytes(sourceBytes);
  }

  // Color
  const color = note.properties ? note.properties.color : null;
  if (color) {
    const colorBytes = encoder.encode(color);
    pushBytes(new Uint8Array([colorBytes.length]));
    pushBytes(colorBytes);
  } else {
    pushBytes(new Uint8Array([0]));
  }

  // Instrument
  const instrument = note.properties ? note.properties.instrument : null;
  if (instrument) {
    const instBytes = encoder.encode(instrument);
    pushBytes(new Uint8Array([instBytes.length]));
    pushBytes(instBytes);
  } else {
    pushBytes(new Uint8Array([0]));
  }
}

/**
 * Deserialize an ArrayBuffer (.rmtb) back to a Module
 * @param {ArrayBuffer} buffer
 * @returns {Module}
 */
export function deserializeBinaryModule(buffer) {
  const data = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let offset = 0;

  // Validate magic
  ensureBytes(data, offset, MAGIC.length);
  for (let i = 0; i < MAGIC.length; i++) {
    if (data[offset++] !== MAGIC[i]) {
      throw new Error('Invalid .rmtb file: bad magic bytes');
    }
  }

  // Version
  ensureBytes(data, offset, 1);
  const version = data[offset++];
  if (version !== FORMAT_VERSION) {
    throw new Error(`Unsupported .rmtb version: ${version}`);
  }

  // Deserialize base note
  const { note: baseNoteData, newOffset } = deserializeNote(data, view, offset);
  offset = newOffset;

  // Build base note variables for Module constructor
  const baseVars = {};
  for (const [varName, expr] of Object.entries(baseNoteData.expressions)) {
    if (expr.sourceText) {
      baseVars[varName] = expr.sourceText;
    }
  }
  if (baseNoteData.color) baseVars.color = baseNoteData.color;
  if (baseNoteData.instrument) baseVars.instrument = baseNoteData.instrument;

  const module = new Module(baseVars);

  // Also restore bytecodes directly onto base note expressions
  for (const [varName, exprData] of Object.entries(baseNoteData.expressions)) {
    const noteExpr = module.baseNote.getExpression(varName);
    if (noteExpr && exprData.bytecode.length > 0) {
      noteExpr.bytecode.set(exprData.bytecode);
      noteExpr.length = exprData.bytecode.length;
      noteExpr.sourceText = exprData.sourceText;
      noteExpr.dependencies = exprData.dependencies;
      noteExpr.depCount = exprData.depCount;
      noteExpr.referencesBase = exprData.referencesBase;
    }
  }

  // Note count
  ensureBytes(data, offset, 2);
  const noteCount = view.getUint16(offset, false);
  offset += 2;

  // Deserialize notes
  for (let i = 0; i < noteCount; i++) {
    const { note: noteData, newOffset: nOff } = deserializeNote(data, view, offset);
    offset = nOff;

    // Build note variables
    const noteVars = {};
    for (const [varName, expr] of Object.entries(noteData.expressions)) {
      if (expr.sourceText) {
        noteVars[varName] = expr.sourceText;
      }
    }
    if (noteData.color) noteVars.color = noteData.color;
    if (noteData.instrument) noteVars.instrument = noteData.instrument;

    const note = new Note(noteData.id, noteVars);
    note.module = module;

    // Restore bytecodes directly
    for (const [varName, exprData] of Object.entries(noteData.expressions)) {
      const noteExpr = note.getExpression(varName);
      if (noteExpr && exprData.bytecode.length > 0) {
        noteExpr.bytecode.set(exprData.bytecode);
        noteExpr.length = exprData.bytecode.length;
        noteExpr.sourceText = exprData.sourceText;
        noteExpr.dependencies = exprData.dependencies;
        noteExpr.depCount = exprData.depCount;
        noteExpr.referencesBase = exprData.referencesBase;
      }
    }

    module.notes[noteData.id] = note;
    if (noteData.id >= module.nextId) {
      module.nextId = noteData.id + 1;
    }
    module._registerNoteDependencies(note);
  }

  module.invalidateAll();

  return module;
}

function deserializeNote(data, view, offset) {
  ensureBytes(data, offset, 2);
  const id = view.getUint16(offset, false);
  offset += 2;

  ensureBytes(data, offset, 1);
  const varCount = data[offset++];

  const expressions = {};

  for (let i = 0; i < varCount; i++) {
    ensureBytes(data, offset, 1);
    const varIndex = data[offset++];
    const varName = VAR_NAMES[varIndex]; // undefined if index beyond current VAR_NAMES

    // Bytecode
    ensureBytes(data, offset, 2);
    const bytecodeLen = view.getUint16(offset, false);
    offset += 2;
    ensureBytes(data, offset, bytecodeLen);
    const bytecode = data.slice(offset, offset + bytecodeLen);
    offset += bytecodeLen;

    // Source text
    ensureBytes(data, offset, 2);
    const sourceTextLen = view.getUint16(offset, false);
    offset += 2;
    ensureBytes(data, offset, sourceTextLen);
    const sourceText = decoder.decode(data.slice(offset, offset + sourceTextLen));
    offset += sourceTextLen;

    // Forward compatibility: skip unknown variable indices gracefully
    if (!varName) {
      console.warn(`[.rmtb] Unknown varIndex ${varIndex} in note ${id}, skipping`);
      continue;
    }

    // Extract dependency info from bytecode (with bounds checking)
    const deps = [];
    let referencesBase = false;
    for (let j = 0; j < bytecodeLen; ) {
      const op = bytecode[j];
      if (op === 0x02) { // LOAD_REF
        if (j + 3 >= bytecodeLen) break; // need noteId(2) + varIdx(1)
        const noteId = (bytecode[j + 1] << 8) | bytecode[j + 2];
        if (!deps.includes(noteId)) deps.push(noteId);
        j += 4; // op + noteId(2) + varIdx(1)
      } else if (op === 0x03) { // LOAD_BASE
        if (j + 1 >= bytecodeLen) break; // need varIdx(1)
        referencesBase = true;
        j += 2; // op + varIdx(1)
      } else if (op === 0x01) { // LOAD_CONST
        if (j + 8 >= bytecodeLen) break; // need num(4) + den(4)
        j += 9; // op + num(4) + den(4)
      } else if (op === 0x04) { // LOAD_CONST_BIG
        j += 1; // op
        if (j >= bytecodeLen) break;
        j += 1; // sign
        if (j + 1 >= bytecodeLen) break;
        const numLen = (bytecode[j] << 8) | bytecode[j + 1];
        j += 2;
        if (j + numLen > bytecodeLen) break;
        j += numLen;
        if (j + 1 >= bytecodeLen) break;
        const denLen = (bytecode[j] << 8) | bytecode[j + 1];
        j += 2;
        if (j + denLen > bytecodeLen) break;
        j += denLen;
      } else {
        j += 1; // all other ops are single-byte
      }
    }

    expressions[varName] = {
      bytecode,
      sourceText,
      dependencies: new Uint16Array(deps),
      depCount: deps.length,
      referencesBase,
    };
  }

  // Color
  ensureBytes(data, offset, 1);
  const colorLen = data[offset++];
  ensureBytes(data, offset, colorLen);
  const rawColor = colorLen > 0 ? decoder.decode(data.slice(offset, offset + colorLen)) : null;
  offset += colorLen;
  const color = rawColor ? validateColorInput(rawColor) : null;
  if (rawColor && !color) {
    console.warn(`[.rmtb] Invalid color in note ${id}, discarding`);
  }

  // Instrument
  ensureBytes(data, offset, 1);
  const instLen = data[offset++];
  ensureBytes(data, offset, instLen);
  const rawInstrument = instLen > 0 ? decoder.decode(data.slice(offset, offset + instLen)) : null;
  offset += instLen;
  const instrument = rawInstrument ? validateInstrumentName(rawInstrument) : null;
  if (rawInstrument && !instrument) {
    console.warn(`[.rmtb] Invalid instrument name in note ${id}, discarding`);
  }

  return {
    note: { id, expressions, color, instrument },
    newOffset: offset,
  };
}
