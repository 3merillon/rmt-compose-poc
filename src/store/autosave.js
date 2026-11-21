/**
 * The autosave: the module's JSON text (Module.createModuleJSONString), kept in
 * IndexedDB so that a reload resumes where the user left off.
 *
 * It used to be localStorage, which holds about 5 MB per origin: a module of
 * some 30,000 notes no longer fitted, and every edit's save failed (the old
 * text stayed, so a reload brought back whatever was saved last). Writing the
 * text there also cost the edit itself about 9 ms at 20,000 notes, since
 * localStorage writes synchronously. IndexedDB holds far more and writes off
 * the main thread.
 *
 * - An edit's text is written after the frame that shows the edit, and only
 *   the latest: edits in the same frame make one write. Writes land in the
 *   order they were started (IndexedDB runs read-write transactions on one
 *   store in creation order).
 * - Leaving the page or hiding it writes at once (saveModuleTextNow).
 * - A module in localStorage under `rmt:moduleSnapshot:v1` (a session saved
 *   before the move, or a module a script put there) opens first, and is
 *   moved here: the localStorage copy is removed once IndexedDB holds the text.
 * - Without IndexedDB (or when a write to it fails) the text goes to
 *   localStorage, as before.
 */
const DB_NAME = 'rmt-compose';
const DB_VERSION = 1;
const STORE = 'autosave';
const MODULE_KEY = 'module';
const UNLOADABLE_KEY = 'unloadable';
/** Where the autosave lived before, and where a script may still put a module to open. */
export const LEGACY_KEY = 'rmt:moduleSnapshot:v1';

let dbPromise = null;
function openDb() {
  if (dbPromise) return dbPromise;
  const opening = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined' || !indexedDB) {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { reject(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab upgrading or deleting the database: let it, and open again next time
      db.onversionchange = () => { try { db.close(); } catch {} dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
  dbPromise = opening;
  opening.catch(() => { if (dbPromise === opening) dbPromise = null; });
  return opening;
}

function request(mode, run) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = run(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    if (mode === 'readwrite' && typeof tx.commit === 'function') { try { tx.commit(); } catch {} }
  }));
}
const idbPut = (key, value) => request('readwrite', (s) => s.put(value, key));
const idbGet = (key) => request('readonly', (s) => s.get(key));
const idbDelete = (key) => request('readwrite', (s) => s.delete(key));

// Whether localStorage holds a module under LEGACY_KEY that IndexedDB has not replaced
let legacyPresent = false;
// The text of the newest write started, and what waits for a frame
let lastStarted = null;
let pending = null; // { text, context }
let scheduleGen = 0;
let scheduled = false;
let inFlight = 0;
let waiters = [];
// Set by clearSavedModule({ hold: true }): nothing more is written from this page
let held = false;

function settle() {
  if (inFlight || pending || scheduled) return;
  const w = waiters;
  waiters = [];
  for (const resolve of w) resolve();
}

function dropLegacy() {
  if (!legacyPresent) return;
  legacyPresent = false;
  try { localStorage.removeItem(LEGACY_KEY); } catch {}
}

function write(text, context) {
  if (held) { settle(); return; }
  lastStarted = text;
  inFlight++;
  idbPut(MODULE_KEY, text)
    .then(dropLegacy, (e) => {
      // The old store, as a fallback, so that the session is not lost
      try {
        localStorage.setItem(LEGACY_KEY, text);
        legacyPresent = true;
        console.warn(`[RMT] Autosave (${context}): IndexedDB failed, saved to localStorage instead:`, e);
      } catch (e2) {
        console.error(`[RMT] Autosave failed (${context}):`, e, e2);
      }
    })
    .finally(() => { inFlight--; settle(); });
}

function runPending() {
  scheduled = false;
  if (!pending) { settle(); return; }
  const { text, context } = pending;
  pending = null;
  write(text, context);
}

/**
 * Save the module's text after the frame that shows the edit (a requestAnimationFrame
 * callback runs just before the paint; a timer set from it runs after). A hidden tab
 * draws no frames, so a timer writes it too. Only the latest text is written.
 */
export function saveModuleText(text, context = 'history capture') {
  if (typeof text !== 'string') return;
  pending = { text, context };
  if (scheduled) return;
  scheduled = true;
  const gen = ++scheduleGen;
  const go = () => { if (scheduled && gen === scheduleGen) runPending(); };
  try {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(go, 0));
  } catch {}
  setTimeout(go, 250);
}

/**
 * Save the module's text now (leaving or hiding the page). Nothing is written when
 * it is the text of the newest write and nothing newer waits.
 */
export function saveModuleTextNow(text, context) {
  if (typeof text !== 'string') return;
  if (!pending && text === lastStarted) return;
  pending = null;
  scheduled = false;
  scheduleGen++;
  write(text, context);
}

/** Start a waiting write now. */
export function flushAutosave() {
  if (scheduled) runPending();
  return whenSaved();
}

/** Resolves once nothing waits to be written and every write started has finished. */
export function whenSaved() {
  if (!inFlight && !pending && !scheduled) return Promise.resolve();
  return new Promise((resolve) => waiters.push(resolve));
}

/**
 * The saved module's text and where it came from ('localStorage' or 'indexedDB'),
 * or null. localStorage first: a session saved before the move, or a module a
 * script put there to open.
 */
export async function loadSavedModuleText() {
  let text = null;
  try { text = localStorage.getItem(LEGACY_KEY); } catch {}
  if (text != null) {
    legacyPresent = true;
    return { text, source: 'localStorage' };
  }
  try {
    const value = await idbGet(MODULE_KEY);
    if (typeof value === 'string') {
      lastStarted = value;
      return { text: value, source: 'indexedDB' };
    }
  } catch (e) {
    console.error('[RMT] Could not read the autosave from IndexedDB:', e);
  }
  return null;
}

/** The saved module's text as it is now in the store (for checks), or null. */
export async function readSavedModuleText() {
  if (legacyPresent) {
    try { return localStorage.getItem(LEGACY_KEY); } catch { return null; }
  }
  try {
    const value = await idbGet(MODULE_KEY);
    return typeof value === 'string' ? value : null;
  } catch {
    try { return localStorage.getItem(LEGACY_KEY); } catch { return null; }
  }
}

/**
 * Forget the saved module (both stores), and anything waiting to be written. With
 * hold, this page writes nothing more (for a reload that should start from the
 * default module: leaving the page would otherwise save it again).
 */
export async function clearSavedModule({ hold = false } = {}) {
  if (hold) held = true;
  pending = null;
  scheduled = false;
  scheduleGen++;
  lastStarted = null;
  legacyPresent = false;
  try { localStorage.removeItem(LEGACY_KEY); } catch {}
  try { await idbDelete(MODULE_KEY); } catch {}
  settle();
}

/**
 * Make text the saved module, and write nothing more from this page (for a reload
 * that should open it: leaving the page would otherwise save the current module).
 */
export async function replaceSavedModule(text) {
  held = true;
  pending = null;
  scheduled = false;
  scheduleGen++;
  try {
    await idbPut(MODULE_KEY, text);
    legacyPresent = true; // the localStorage copy, if any, would open first: remove it
    dropLegacy();
  } catch (e) {
    localStorage.setItem(LEGACY_KEY, text); // throws when it does not fit either
  }
  settle();
}

/** Keep a session that could not be loaded, beside the autosave. */
export async function keepUnloadable(text) {
  try {
    await idbPut(UNLOADABLE_KEY, text);
    return 'IndexedDB (rmt-compose / autosave / "unloadable")';
  } catch {
    try { localStorage.setItem(`${LEGACY_KEY}:unloadable`, text); return `localStorage ${LEGACY_KEY}:unloadable`; } catch {}
  }
  return null;
}

// A write that waits for a frame goes out at once when the page is hidden or left
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const now = () => { if (scheduled) runPending(); };
  try {
    window.addEventListener('pagehide', now);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') now(); });
  } catch {}
}
