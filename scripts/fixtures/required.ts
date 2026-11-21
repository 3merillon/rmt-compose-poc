import assert from 'node:assert/strict';

/** Fail at the lookup when a fixture is missing a note, evaluated value or scheduled event. */
export function required<T>(value: T | null | undefined): T {
  assert(value !== null && value !== undefined, 'Expected a value from the test fixture');
  return value;
}
