import { readFileSync } from 'node:fs';
import { isInputScore, isRecord, type ScoreNote, type ScoreFields } from '../src/model-types.ts';

type LibraryNote = ScoreNote & Record<string, unknown> & {
  startTime: string;
  frequency?: string;
}

function fields(value: unknown): value is ScoreFields {
  if (!isRecord(value)) return false;
  for (const name of ['startTime', 'duration', 'frequency', 'attack', 'release', 'amplitude', 'instrument', 'repeat']) {
    if (value[name] !== undefined && typeof value[name] !== 'string') return false;
  }
  return value.measure === undefined || typeof value.measure === 'boolean';
}

/** Read the native, timed scores used by the library-maintenance generators. */
export function readLibraryScore(path: string | URL): {baseNote: ScoreFields; notes: LibraryNote[]} {
  const data: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!isInputScore(data) || !fields(data.baseNote)) throw new Error(`Invalid library score in ${path}`);
  const notes = data.notes;
  if (!notes.every((n): n is LibraryNote => typeof n.id === 'number' && fields(n) && typeof n.startTime === 'string')) {
    throw new Error(`Invalid timed note in ${path}`);
  }
  return { ...data, baseNote: data.baseNote, notes };
}
