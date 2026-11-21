// Lightweight Event Bus for incremental decoupling
// Usage:
//   import { eventBus } from './utils/event-bus.js';
//   eventBus.on('note:selected', (payload) => { ... });
//   eventBus.emit('note:selected', { id: 1 });
//
// This is intentionally minimal and dependency-free.

import type { Note } from '../note.ts';
import type { ExactValue } from '../value/exact.ts';
import type { SettingsChange } from '../settings/settings-store.ts';
import type { Settings } from '../settings/settings-schema.ts';
import type { PagedSnapshot } from '../store/snapshot-pages.ts';

export interface HistoryCapture {
  label?: string; snapshot?: unknown; snapshotStr?: string; version?: PagedSnapshot;
}
export interface HistoryRestore {
  source: 'undo' | 'redo'; label: string; snapshot: unknown; version?: PagedSnapshot;
}
export interface AppEvents {
  'audio:masterVolumeInput': [{value: number}];
  'display:transposition': [{pass: number; factor: ExactValue | null}];
  'history:capture': [HistoryCapture];
  'history:seedIfEmpty': [HistoryCapture];
  'history:requestRestore': [HistoryRestore];
  'history:restored': [{source: 'undo' | 'redo'}];
  'history:stackChanged': [{undo: number; redo: number; canUndo: boolean; canRedo: boolean}];
  'history:undo': [];
  'history:redo': [];
  'modals:cleared': [];
  'modals:init': [];
  'modals:requestRefresh': [{note: Note | null | undefined; measureId: number | null; clickedElement?: Element | null}];
  'modals:show': [{noteId: number | null; isMeasure: boolean}];
  'module:repeatChanged': [{repeat: string | null}];
  'player:importModuleAtTarget': [{targetNoteId: number | null; moduleData: unknown; clientX?: number; clientY?: number}];
  'player:invalidateModuleEndTimeCache': [change?: {noteId: number}];
  'player:octaveChange': [{noteId: number; direction: 'up' | 'down'}];
  'player:requestPause': [];
  'player:selectNote': [{noteId: number}];
  'settings:changed': [SettingsChange];
  'settings:loaded': [{settings: Settings}];
  'settings:panelToggled': [{open: boolean}];
  'toolbar:built': [];
  'workspace:groupMoveCommit': [{ids: number[]; deltaSec: number}];
  'workspace:marqueeCommit': [{ids: number[]; additive?: boolean; touch?: boolean}];
  'workspace:measureResizeCommit': [{measureId: number; newStartSec: number}];
  'workspace:multiSelectToggle': [{id: number; touch?: boolean}];
  'workspace:noteMoveCommit': [{noteId: number; newStartSec: number}];
  'workspace:noteResizeCommit': [{noteId: number; newDurationSec: number}];
}

type Listener<Args extends unknown[]> = (...args: Args) => void;

export class EventBus<Events extends { [Key in keyof Events]: unknown[] } = Record<string, unknown[]>> {
  declare _events: Map<keyof Events & string, Set<unknown>>;
  constructor() {
    this._events = new Map();
  }

  private listenersFor<K extends keyof Events & string>(event: K) {
    // A Map cannot express a value type that depends on its key. Only on()
    // inserts handlers, under the same typed event used for lookup.
    return this._events.get(event) as Set<Listener<Events[K]>> | undefined;
  }

  /**
   * Subscribe to an event.
   * @param {string} event
   * @param {Function} handler
   * @returns {Function} unsubscribe function
   */
  on<K extends keyof Events & string>(event: K, handler: Listener<Events[K]>) {
    if (!this._events.has(event)) {
      this._events.set(event, new Set());
    }
    const set = this.listenersFor(event);
    set!.add(handler);
    return () => this.off(event, handler);
  }

  /**
   * Subscribe once to an event, auto-unsubscribes after first call.
   * @param {string} event
   * @param {Function} handler
   * @returns {Function} unsubscribe function
   */
  once<K extends keyof Events & string>(event: K, handler: Listener<Events[K]>) {
    const wrapper = (...args: Events[K]) => {
      try {
        handler(...args);
      } finally {
        this.off(event, wrapper);
      }
    };
    return this.on(event, wrapper);
  }

  /**
   * Unsubscribe a handler from an event.
   * @param {string} event
   * @param {Function} handler
   */
  off<K extends keyof Events & string>(event: K, handler: Listener<Events[K]>) {
    const set = this.listenersFor(event);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) {
      this._events.delete(event);
    }
  }

  /**
   * Emit an event to all subscribers.
   * @param {string} event
   */
  emit<K extends keyof Events & string>(event: K, ...args: Events[K]) {
    const set = this.listenersFor(event);
    if (!set || set.size === 0) return;
    // Clone to guard against mutations during emit
    const listeners = Array.from(set);
    for (const fn of listeners) {
      try {
        fn(...args);
      } catch (err) {
        // Ensure one faulty handler does not break the bus
        console.error(`[event-bus] Handler error for "${event}":`, err);
      }
    }
  }

  /**
   * Remove all listeners for a specific event or all events when omitted.
   * @param {string} [event]
   */
  clear(event?: keyof Events & string) {
    if (typeof event === 'string') {
      this._events.delete(event);
    } else {
      this._events.clear();
    }
  }

  /**
   * Get current listeners for an event.
   * @param {string} event
   * @returns {Function[]} listeners
   */
  listeners<K extends keyof Events & string>(event: K): Listener<Events[K]>[] {
    const set = this.listenersFor(event);
    return set ? Array.from(set) : [];
  }

  /**
   * Number of event topics currently registered.
   * @returns {number}
   */
  size() {
    return this._events.size;
  }
}

// Export a shared singleton for app-wide use
export const eventBus = new EventBus<AppEvents>();