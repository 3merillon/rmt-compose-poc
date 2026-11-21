import { readFileSync } from 'node:fs';
import { isRecord } from '../../src/model-types.ts';

function dictionary<T>(value: unknown, read: (entry: unknown) => T): Record<string, T> {
  if (!isRecord(value)) throw new Error('Expected a fixture dictionary');
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, read(entry)]));
}

export function readOracle<T>(path: string, readEntry: (entry: unknown) => T): Record<string,T> {
  const fixture: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!isRecord(fixture)) throw new Error(`Invalid oracle in ${path}`);
  return dictionary(fixture.modules, readEntry);
}

const rationalText = (value: unknown): value is string | null => typeof value === 'string' || value === null;

export function legacyValues(notes: unknown) {
  return dictionary(notes, entry => {
    if (!isRecord(entry)) throw new Error('Expected legacy note values');
    const { t, d, f, a, atk, rel, c } = entry;
    if (![t,d,f,a,atk,rel].every(rationalText) || typeof c !== 'number') throw new Error('Invalid legacy oracle row');
    // every() checked each of the six optional rational values above.
    return entry as Record<'t' | 'd' | 'f' | 'a' | 'atk' | 'rel', string | null> & {c: number};
  });
}

export function oldTimeValues(notes: unknown) {
  return dictionary(notes, entry => {
    if (!isRecord(entry)) throw new Error('Expected time-model note values');
    const {t,d,f,a,ml,tempo,measure} = entry;
    if (!rationalText(t) || !rationalText(d) || !rationalText(f) || !rationalText(a)
      || !(ml === undefined || rationalText(ml)) || !(tempo === undefined || rationalText(tempo))) {
      throw new Error('Invalid time-model oracle row');
    }
    return {t,d,f,a,ml,tempo,measure};
  });
}

export function librarySounds(entry: unknown) {
  if (!isRecord(entry)) throw new Error('Expected library oracle entry');
  const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');
  if (!strings(entry.notes) || !strings(entry.bars)) throw new Error('Invalid library notes or bars');
  return { notes: entry.notes, bars: entry.bars };
}
