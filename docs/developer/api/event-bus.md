# EventBus

The EventBus provides a simple publish-subscribe system for decoupled communication between components.

## Overview

```javascript
import { eventBus } from './utils/event-bus.js'

// Subscribe
eventBus.on('player:invalidateModuleEndTimeCache', () => {
  // Handle event
})

// Publish
eventBus.emit('player:invalidateModuleEndTimeCache')
```

## API

### on()

```javascript
eventBus.on(event, handler)
```

Subscribe to an event.

| Parameter | Type | Description |
|-----------|------|-------------|
| `event` | string | Event name |
| `handler` | function | Callback function |

Returns: `void`

Example:
```javascript
eventBus.on('note:changed', (noteId, property) => {
  console.log(`Note ${noteId} ${property} changed`)
})
```

### once()

```javascript
eventBus.once(event, handler)
```

Subscribe to an event, automatically unsubscribing after first call.

| Parameter | Type | Description |
|-----------|------|-------------|
| `event` | string | Event name |
| `handler` | function | Callback function |

Example:
```javascript
eventBus.once('module:loaded', (module) => {
  initializeUI(module)
})
```

### off()

```javascript
eventBus.off(event, handler)
```

Unsubscribe from an event.

| Parameter | Type | Description |
|-----------|------|-------------|
| `event` | string | Event name |
| `handler` | function | The exact handler to remove |

Example:
```javascript
const handler = () => console.log('fired')
eventBus.on('test', handler)
eventBus.off('test', handler)
```

### emit()

```javascript
eventBus.emit(event, ...args)
```

Publish an event with optional arguments.

| Parameter | Type | Description |
|-----------|------|-------------|
| `event` | string | Event name |
| `...args` | any | Arguments passed to handlers |

Example:
```javascript
eventBus.emit('player:timeUpdate', currentTime)
```

### listeners()

```javascript
const handlers = eventBus.listeners(event)
// → Set<function>
```

Get all handlers for an event.

### clear()

```javascript
eventBus.clear(event)  // Clear handlers for event
eventBus.clear()       // Clear all handlers
```

Remove handlers.

## Events in RMT Compose

### Core Events

| Event | Arguments | Description |
|-------|-----------|-------------|
| `player:invalidateModuleEndTimeCache` | - | Module changed, invalidate caches |
| `player:timeUpdate` | `time: number` | Playback position changed |
| `player:play` | - | Playback started |
| `player:pause` | - | Playback paused |
| `player:stop` | - | Playback stopped |

### UI Events

| Event | Arguments | Description |
|-------|-----------|-------------|
| `selection:changed` | `noteIds: Set` | Selection changed |
| `viewport:changed` | `bounds: object` | Camera moved/zoomed |

## Implementation Details

### Internal Structure

```javascript
class EventBus {
  constructor() {
    this._events = new Map()  // Map<string, Set<function>>
  }
}
```

### Handler Isolation

Errors in one handler don't affect others:

```javascript
emit(event, ...args) {
  const handlers = this._events.get(event)
  if (!handlers) return

  // Clone to allow modifications during iteration
  for (const handler of [...handlers]) {
    try {
      handler(...args)
    } catch (e) {
      console.error(`Error in ${event} handler:`, e)
    }
  }
}
```

### Memory Management

```javascript
// Remove handler when component unmounts
componentWillUnmount() {
  eventBus.off('event', this.handler)
}
```

## Patterns

### Component Communication

```javascript
// Component A (publisher)
noteEditor.on('save', () => {
  eventBus.emit('note:updated', this.noteId)
})

// Component B (subscriber)
noteList.init(() => {
  eventBus.on('note:updated', (id) => {
    this.refreshNote(id)
  })
})
```

### Async Events

```javascript
// Emit doesn't wait for handlers
eventBus.emit('data:loading')
await fetchData()
eventBus.emit('data:loaded', data)
```

### Debugging

```javascript
// Log all events
const originalEmit = eventBus.emit.bind(eventBus)
eventBus.emit = (event, ...args) => {
  console.log(`[Event] ${event}`, args)
  originalEmit(event, ...args)
}
```

## Best Practices

1. **Use namespaced events**: `component:action` format
2. **Clean up subscriptions**: Always `off()` when done
3. **Avoid heavy handlers**: Keep handlers fast
4. **Don't rely on order**: Handler order is undefined
5. **Use `once()` for one-time events**: Prevents leaks

## Example: Custom Event

```javascript
// Define event
const EVENTS = {
  MODULE_SAVED: 'module:saved'
}

// Emit when saving
async function saveModule(module) {
  const json = module.toJSON()
  await downloadFile(json)
  eventBus.emit(EVENTS.MODULE_SAVED, module)
}

// Listen for save
eventBus.on(EVENTS.MODULE_SAVED, (module) => {
  showNotification('Module saved!')
})
```

## See Also

- [Data Flow](/developer/architecture/data-flow) - Event flow in the system
- [Module Class](/developer/api/module) - Module events
