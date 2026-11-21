/**
 * How large a module the UI accepts (Load Module, library upload, Load UI,
 * Copy to Modules).
 *
 * MAX_NOTE_ID in src/binary-note.js limits individual IDs. This separate cap
 * bounds score memory and the size of the single-string IndexedDB autosave.
 * See "Limits" in docs/developer/performance.md for measurements.
 */
export const MAX_MODULE_NOTES = 500000;
export const DEFAULT_DETAIL_CUTOFF = 1536;

/**
 * About 160 bytes of JSON per note of a typical module, with room to spare.
 * Below 127 MB, so that the module's text stays within one IndexedDB value
 * when the autosave writes it (one byte per character, unless the text holds
 * one above U+00FF)
 */
export const MAX_MODULE_BYTES = 120 * 1024 * 1024;
