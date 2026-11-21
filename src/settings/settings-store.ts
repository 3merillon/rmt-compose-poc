/**
 * Settings store — the single source of truth for user settings (ROADMAP.md
 * Phase 2). Persists to localStorage `rmt:settings:v1`, validates on load,
 * and broadcasts changes on the shared eventBus so Theme / Arrows / Audio /
 * Library can react live.
 *
 * Events:
 *   'settings:loaded'  ({ settings })              — once at construction
 *   'settings:changed' ({ path, value, settings }) — after every set/reset
 *
 * Path syntax is dot-delimited: e.g. `arrows.up`, `audio.reverb.wet`,
 * `appearance.themeId`. Consumers filter by prefix.
 */

import { eventBus } from '../utils/event-bus.js';
import {
  type Settings,
  SETTINGS_VERSION,
  defaultSettings,
  validateSettings,
  migrate,
} from './settings-schema.ts';

const STORAGE_KEY = 'rmt:settings:v1';

type AtPath<T, P extends string> =
  P extends '' ? T :
  P extends keyof T ? T[P] :
  P extends `${infer K}.${infer Rest}` ? K extends keyof T ? AtPath<T[K], Rest> : unknown : unknown;

export interface SettingsChange { path: string; value: unknown; settings: Settings }
type Subscriber = (change: SettingsChange) => void;

function deepClone<T>(obj: T): T {
  // Settings are plain JSON-compatible data.
  return JSON.parse(JSON.stringify(obj));
}

function getAtPath(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function setAtPath(obj: Settings, path: string, value: unknown) {
  const parts = path.split('.');
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (cur[p] == null || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

class SettingsStore {
  _settings: Settings;
  _subscribers: Set<Subscriber>;
  constructor() {
    this._settings = this._load();
    this._subscribers = new Set();
    // Announce initial state so late subscribers can pull via get().
    // Deferred a microtask so importers can subscribe first if they wish.
    Promise.resolve().then(() => {
      try {
        eventBus.emit('settings:loaded', { settings: this.getAll() });
      } catch (e) {
        console.warn('[settings] loaded emit failed', e);
      }
    });
  }

  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultSettings();
      const parsed = JSON.parse(raw);
      return migrate(parsed);
    } catch (e) {
      console.warn('[settings] failed to load; using defaults', e);
      return defaultSettings();
    }
  }

  _persist() {
    try {
      this._settings.version = SETTINGS_VERSION;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._settings));
    } catch (e) {
      // Quota / private mode — non-fatal, settings stay in-memory this session.
      console.warn('[settings] persist failed', e);
    }
  }

  _emit(path: string, value: unknown) {
    const payload = { path, value, settings: this.getAll() };
    for (const fn of Array.from(this._subscribers)) {
      try { fn(payload); } catch (e) { console.error('[settings] subscriber error', e); }
    }
    try { eventBus.emit('settings:changed', payload); } catch (e) { /* noop */ }
  }

  /**
   * Get a deep copy of the whole settings object.
   */
  getAll() {
    return deepClone(this._settings);
  }

  /**
   * Get a value at a dot path. Returns a deep copy for objects.
   * @param {string} path
   */
  get(): Settings;
  get<P extends string>(path: P): AtPath<Settings, P>;
  get(path?: string): unknown {
    if (!path) return this.getAll();
    const v = getAtPath(this._settings, path);
    return (v && typeof v === 'object') ? deepClone(v) : v;
  }

  /**
   * Set a value at a dot path, re-validate the whole tree, persist, and emit.
   * Re-validation keeps derived invariants (e.g. reciprocal arrow `down`) and
   * clamps out-of-range values; the pre-edit tree is passed along so an invalid
   * edit heals back to the user's previous value, not the schema default.
   * @param {string} path
   * @param {unknown} value
   */
  set<P extends string>(path: P, value: unknown) {
    const prev = deepClone(this._settings);
    setAtPath(this._settings, path, value);
    this._settings = validateSettings(this._settings, prev);
    this._persist();
    // Emit the (possibly coerced) canonical value at the path.
    this._emit(path, getAtPath(this._settings, path));
    return this.get(path);
  }

  /**
   * Replace an entire top-level section (appearance/arrows/audio/library).
   * @param {string} section
   * @param {object} value
   */
  setSection<K extends keyof Settings>(section: K, value: unknown) {
    const prev = deepClone(this._settings);
    setAtPath(this._settings, section, value);
    this._settings = validateSettings(this._settings, prev);
    this._persist();
    this._emit(section, getAtPath(this._settings, section));
    return this.get(section);
  }

  /**
   * Reset one top-level section to defaults.
   * @param {string} section
   */
  resetSection<K extends keyof Settings>(section: K) {
    const d = defaultSettings();
    if (!(section in d)) return;
    this._settings[section] = d[section];
    this._settings = validateSettings(this._settings);
    this._persist();
    this._emit(section, getAtPath(this._settings, section));
  }

  /**
   * Reset everything to factory defaults.
   */
  resetAll() {
    this._settings = defaultSettings();
    this._persist();
    this._emit('', this.getAll());
  }

  /**
   * Subscribe to any settings change. Returns an unsubscribe function.
   * (In addition to the eventBus 'settings:changed' broadcast.)
   * @param {(payload:{path:string,value:unknown,settings:object})=>void} fn
   */
  subscribe(fn: Subscriber) {
    this._subscribers.add(fn);
    return () => this._subscribers.delete(fn);
  }
}

// App-wide singleton.
export const settingsStore = new SettingsStore();
