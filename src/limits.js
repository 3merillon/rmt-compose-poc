/**
 * How large a module the UI accepts (Load Module, library upload, Load UI,
 * Copy to Modules).
 *
 * Memory is the limit, not note ids (those go to MAX_NOTE_ID in
 * src/binary-note.js). A loaded note costs about 8 KB of JavaScript heap
 * today (notes, compiled expressions, dependency graph, records), and a tab's
 * heap stops near 4 GB, so 300,000 notes is already close to the edge.
 * Measured in Node: 100,000 notes take about 0.8 GB and load in about 3 s.
 * Raise these when the memory per note comes down.
 */
export const MAX_MODULE_NOTES = 250000;

/** About 160 bytes of JSON per note of a typical module, with room to spare */
export const MAX_MODULE_BYTES = 64 * 1024 * 1024;
