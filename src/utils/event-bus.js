// Lightweight Event Bus for incremental decoupling
// Usage:
//   import { eventBus } from './utils/event-bus.js';
//   eventBus.on('note:selected', (payload) => { ... });
//   eventBus.emit('note:selected', { id: 1 });
//
// This is intentionally minimal and dependency-free.

export class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._events = new Map();
  }

  /**
   * Subscribe to an event.
   * @param {string} event
   * @param {Function} handler
   * @returns {Function} unsubscribe function
   */
  on(event, handler) {
    if (!this._events.has(event)) {
      this._events.set(event, new Set());
    }
    const set = this._events.get(event);
    set.add(handler);
    return () => this.off(event, handler);
  }

  /**
   * Subscribe once to an event, auto-unsubscribes after first call.
   * @param {string} event
   * @param {Function} handler
   * @returns {Function} unsubscribe function
   */
  once(event, handler) {
    const wrapper = (...args) => {
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
  off(event, handler) {
    const set = this._events.get(event);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) {
      this._events.delete(event);
    }
  }

  /**
   * Emit an event to all subscribers.
   * @param {string} event
   * @param  {...any} args
   */
  emit(event, ...args) {
    const set = this._events.get(event);
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
  clear(event) {
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
  listeners(event) {
    const set = this._events.get(event);
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
export const eventBus = new EventBus();