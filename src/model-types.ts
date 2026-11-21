import type Fraction from 'fraction.js';
import type { BinaryExpression, ExpressionName } from './binary-note.ts';
import type { Irrational, Approx } from './value/exact.ts';

export type { ExpressionName } from './binary-note.ts';
export type NoteId = number;

/** New saves contain DSL source for each written variable. An omitted variable
 * is distinct from zero, a rest, or an inherited interpretation value. */
export type ScoreFields = Partial<Record<ExpressionName, string>> & {
  color?: unknown;
  instrument?: string;
  repeat?: string;
  measure?: boolean;
};
export type ScoreNote = ScoreFields & { id: NoteId };
export interface Score {
  baseNote: ScoreFields;
  notes: ScoreNote[];
  instrumentRule?: string;
}

/** Input to migration may contain retired variable names and source strings. */
export type InputFields = Record<string, unknown>;
export interface InputScore {
  baseNote: InputFields;
  notes: InputFields[];
  instrumentRule?: unknown;
}
export function isRecord(value: unknown): value is InputFields {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function isInputScore(value: unknown): value is InputScore {
  return isRecord(value) && isRecord(value.baseNote) && Array.isArray(value.notes) &&
    value.notes.every(isRecord);
}

export interface EvaluationRecord extends Record<ExpressionName, Fraction | null> {
  corruptionFlags: number;
  approxFlags: number;
  exact: Partial<Record<ExpressionName, Irrational | Approx>> | null;
}
export type EvaluationCache = Map<NoteId, EvaluationRecord>;

/** Live notes keep expressions in a nested object. BinaryNote exposes the
 * same slots directly. A tentative cycle check may supply just some slots. */
type Slots = Partial<Record<ExpressionName, BinaryExpression | null>>;
export type ExpressionNote = { id: NoteId } & ({ expressions: Slots } | Slots);
export type NoteLookup = (id: NoteId) => ExpressionNote | null | undefined;
