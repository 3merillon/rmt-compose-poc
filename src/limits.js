/**
 * How large a module the UI accepts (Load Module, library upload, Load UI,
 * Copy to Modules).
 *
 * Not note ids (those go to MAX_NOTE_ID in src/binary-note.js). A loaded
 * note costs about 2.4 KB of JavaScript heap in Edge (the whole app), and a
 * tab's heap stops near 4 GB: 500,000 notes take about 1.1 GB, and a million
 * load. What comes first is the autosave, one IndexedDB value of at most
 * 127 MB (about 800,000 notes of a typical module, half that if its text has
 * a character above U+00FF), and the time an edit takes (about 4 s at
 * 500,000 notes). See "Limits" in docs/developer/performance.md.
 */
export const MAX_MODULE_NOTES = 500000;

/**
 * About 160 bytes of JSON per note of a typical module, with room to spare.
 * Below 127 MB, so that the module's text stays within one IndexedDB value
 * when the autosave writes it (one byte per character, unless the text holds
 * one above U+00FF)
 */
export const MAX_MODULE_BYTES = 120 * 1024 * 1024;
