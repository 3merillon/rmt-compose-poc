import type { Note } from '../note.ts';
import type { EvaluationCache } from '../model-types.ts';
import type { ExactValue } from '../value/exact.ts';

export interface InspectorRow {
  evaluated: unknown;
  raw: unknown;
  exact?: ExactValue | null;
  isDefault?: boolean;
  isInherited?: boolean;
  isCorrupted?: boolean;
  isTransitivelyCorrupted?: boolean | null;
  isRepeat?: boolean;
  transposedPass?: number;
  playerHead?: number | null;
}

export interface InspectorHooks {
  updateVisualNotes: ((evaluation: EvaluationCache, incremental?: boolean) => void) | null;
  updateBaseNoteFraction: (() => void) | null;
  updateBaseNotePosition: (() => void) | null;
  hasMeasurePoints: (() => boolean) | null;
  getLastMeasureId: (() => number | null) | null;
  isLastMeasureInChain: ((id: number) => boolean) | null;
  updateTimingBoundaries: (() => void) | null;
  createMeasureBars: (() => void) | null;
  deleteNoteAndDependencies: ((id: number) => void) | null;
  deleteNoteKeepDependencies: ((id: number) => void) | null;
  cleanSlate: (() => void) | null;
  bringSelectedNoteToFront: ((note: Note, clickedElement: Element | null) => void) | null;
  restoreNotePosition: ((note: Note) => void) | null;
  clearLastSelectedNote: (() => void) | null;
  originalNoteOrder: Map<number, unknown> | null;
  updateDependentRawExpressions: ((id: number, expressions: Record<string, string>) => void) | null;
  selectRelatedNotes: ((id: number, direction: 'dependents' | 'dependencies', which: 't' | 'd' | 'f' | 'all') => void) | null;
}
