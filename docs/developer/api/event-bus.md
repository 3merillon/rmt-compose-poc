---
title: EventBus
description: Reference for the EventBus in src/utils/event-bus.js and the complete catalogue of events RMT Compose actually emits.
---

# EventBus

`EventBus` (`src/utils/event-bus.js`) is a small, dependency-free, synchronous publish/subscribe
bus. It is how subsystems that must not import each other — the renderer and `player.js`, the
settings panel and the audio graph, the module bar and the history stack — talk.

```javascript
import { eventBus } from './utils/event-bus.js'

const off = eventBus.on('history:stackChanged', ({ canUndo, canRedo }) => {
  undoBtn.disabled = !canUndo
  redoBtn.disabled = !canRedo
})

// later
off()
```

`eventBus` is a shared singleton. The `EventBus` class is exported too, if you want a private bus.

## API

### on()

```javascript
const off = eventBus.on(event, handler)
```

Subscribes, and **returns an unsubscribe function**. That return value is the idiomatic cleanup
path in this codebase — `src/settings/settings-panel.js` collects them in a `disposers` array and
calls them when the panel is torn down.

| Parameter | Type | Description |
|---|---|---|
| `event` | string | Topic name |
| `handler` | function | Called with whatever `emit()` passes |

Returns: `Function` — call it to unsubscribe.

### once()

```javascript
const off = eventBus.once(event, handler)
```

Fires at most once, then unsubscribes itself (in a `finally`, so a throwing handler still gets
removed). Also returns an unsubscribe function, for cancelling before the event arrives.

### off()

```javascript
eventBus.off(event, handler)
```

Removes one handler by identity. Removing the last handler for a topic deletes the topic.

### emit()

```javascript
eventBus.emit(event, ...args)
```

**Synchronous.** Handlers run in subscription order, on a snapshot of the listener set, so
subscribing or unsubscribing inside a handler is safe. Every handler is wrapped in a `try/catch`:
one that throws is logged (`[event-bus] Handler error for "<event>":`) and the rest still run.

By convention every event in this app carries **one object argument**, not a positional list.

### listeners()

```javascript
eventBus.listeners(event)  // → Function[] (an Array, not a Set)
```

### size()

```javascript
eventBus.size()  // → number of topics with at least one listener
```

### clear()

```javascript
eventBus.clear('some:event')  // drop that topic's handlers
eventBus.clear()              // drop everything
```

::: info There is no wildcard matching
`component:action` is a naming discipline, nothing more. The bus does no prefix matching — you
cannot subscribe to `workspace:*`. Event names are compared with strict equality.
:::

## Event catalogue

This is every topic in `src/` at the current commit. Payloads are exact.

### player

| Event | Payload | Emitted by | Consumed by |
|---|---|---|---|
| `player:invalidateModuleEndTimeCache` | — | `Note._notifyChange()` — any expression or property change | `player.js` (recompute end time, reposition measure bars) |
| `player:requestPause` | — | modals, workspace commits, history restore, the note widget | `player.js` — stops playback before a mutating edit |
| `player:octaveChange` | `{ noteId, direction: 'up' \| 'down' }` | the ▲/▼ arrows (note widget and canvas), the perf harness | `player.js` — applies the arrow interval to the frequency expression |
| `player:selectNote` | `{ noteId }` | note/measure creation, so the new note lands selected | `player.js` |
| `player:importModuleAtTarget` | `{ targetNoteId, moduleData, clientX, clientY }` | the module bar, when a library icon is dropped on a note | `player.js` — grafts the module in |

### history (undo / redo)

| Event | Payload | Emitted by | Consumed by |
|---|---|---|---|
| `history:capture` | `{ label, snapshot, snapshotStr? }` | every undoable action | `store/history.js` (push) **and** `player.js` (write the localStorage autosave) |
| `history:seedIfEmpty` | `{ label: 'Initial', snapshot, snapshotStr? }` | the same call sites, just before `history:capture` | `store/history.js` |
| `history:undo` / `history:redo` | — | the module-bar buttons, the + menu buttons, Ctrl/⌘+Z and Ctrl/⌘+Y | `store/history.js` |
| `history:requestRestore` | `{ snapshot, source: 'undo' \| 'redo', label }` | `HistoryManager` | `player.js` — rebuilds the module from the snapshot; also clears the selection |
| `history:stackChanged` | `{ undo, redo, canUndo, canRedo }` | `HistoryManager`, after every push/undo/redo | the undo/redo buttons in the module bar and the + menu |

### workspace (canvas gestures → authoritative commit)

The WebGL2 workspace previews a gesture on the GPU and emits a commit event on release;
`player.js` owns the module and writes the expression.

| Event | Payload | Emitted on |
|---|---|---|
| `workspace:noteMoveCommit` | `{ noteId, newStartSec }` | drag of a single note |
| `workspace:groupMoveCommit` | `{ ids, deltaSec }` | drag of a multi-selection |
| `workspace:noteResizeCommit` | `{ noteId, newDurationSec }` | drag of a note's right edge |
| `workspace:measureResizeCommit` | `{ measureId, newStartSec }` | drag of a measure bar |
| `workspace:marqueeCommit` | `{ ids, additive }` | marquee release — **emitted even when `ids` is empty**, so a drag across nothing clears the selection |
| `workspace:multiSelectToggle` | `{ id }` | long-press on a note (the touch path into multi-select) |

All six are consumed by `player.js`.

### settings

| Event | Payload | Emitted by | Consumed by |
|---|---|---|---|
| `settings:changed` | `{ path, value, settings }` — `path` is dotted, e.g. `'audio.defaultInstrument'` | `settingsStore` on every write | `player.js` (audio graph, default instrument, theme), the note widget |
| `settings:loaded` | `{ settings }` | `settingsStore`, once, a microtask after construction | nothing today — the panel and `player.js` pull with `settingsStore.get()` instead |
| `settings:panelToggled` | `{ open }` | the settings panel, on open/close | `main.js` |

A `settings:changed` handler must check `path` — it fires for *every* setting:

```javascript
eventBus.on('settings:changed', ({ path }) => {
  if (path === 'audio.defaultInstrument' || path === 'audio' || path === '') {
    applyDefaultInstrument()
  }
})
```

### modals (the note / measure widget)

| Event | Payload | Emitted by | Consumed by |
|---|---|---|---|
| `modals:show` | `{ noteId, isMeasure }` | the widget, when it opens for a note | `player.js` |
| `modals:cleared` | — | the widget, when it closes | `player.js` subscribes, but the handler is an empty placeholder — nothing happens today |
| `modals:requestRefresh` | `{ note, measureId, clickedElement }` | `player.js` and the widget's own controls, after a commit | the widget — rebuilds itself in place |
| `modals:init` | — | the widget, once | nothing today |

### audio

| Event | Payload | Emitted by | Consumed by |
|---|---|---|---|
| `audio:masterVolumeInput` | `{ value }` (0-1) | the top-bar volume slider, live during the drag | the Audio tab of the settings panel, so the two sliders track each other |

The transport slider only *writes* the `audio.masterVolume` setting when the drag ends, so this
event exists to carry the mid-drag echo that `settings:changed` cannot.

## Patterns

### Cleanup

Keep the unsubscribe function. There is no React here and no component lifecycle — a panel that is
rebuilt without dropping its subscriptions leaks a handler per rebuild.

```javascript
const disposers = []

function build() {
  disposers.push(eventBus.on('settings:changed', onSettings))
  disposers.push(eventBus.on('history:stackChanged', onHistory))
}

function destroy() {
  disposers.forEach((off) => off())
  disposers.length = 0
}
```

### Emitting defensively

Most call sites wrap `emit()` in a `try/catch`, because the bus is imported into code paths that
also run outside the browser (the Node perf benches):

```javascript
try { eventBus.emit('player:requestPause') } catch {}
```

### Debugging

```javascript
const realEmit = eventBus.emit.bind(eventBus)
eventBus.emit = (event, ...args) => {
  console.log('[event]', event, args)
  realEmit(event, ...args)
}
```

## Adding an event

1. Name it `subsystem:action` — the subsystems in use are `player`, `history`, `workspace`,
   `settings`, `modals`, `audio`.
2. Pass a single object payload.
3. Emit from the subsystem that owns the fact; consume where the reaction belongs. The workspace
   never writes expressions; it emits a commit and lets `player.js` do it.
4. Add it to the table above.

## See also

- [Data Flow](/developer/architecture/data-flow) — how a gesture becomes an expression
- [Module Class](/developer/api/module) — `Module` emits nothing; `Note` emits one event
- [Settings](/user-guide/interface/settings) — what `settings:changed` paths correspond to
