# Keyboard Shortcuts

RMT Compose supports keyboard shortcuts for common actions.

## Available Shortcuts

| Shortcut | Action | Description |
|----------|--------|-------------|
| `Ctrl + Z` | Undo | Revert the last change |
| `Cmd + Z` | Undo (Mac) | Revert the last change |
| `Ctrl + Y` | Redo | Reapply the last undone change |
| `Cmd + Y` | Redo (Mac) | Reapply the last undone change |

## Context

These shortcuts work:
- When the workspace is focused
- When no text input is active
- At any time during the session

## History

### Undo Stack

- **Limit**: Up to 50 states are remembered
- **What's tracked**: Note additions, deletions, property changes, module loads
- **What's not tracked**: View changes (pan/zoom), playback state

### Redo Stack

- Cleared when you make a new change after undoing
- Maintains the sequence of undone changes

## Tips

1. **Undo liberally** - Experiment freely knowing you can always go back
2. **Save before major changes** - History is lost when you close the browser
3. **Use redo** - If you undo too far, redo brings back your changes

## Planned Shortcuts

Future versions may include:

| Shortcut | Action |
|----------|--------|
| `Space` | Play/Pause |
| `Escape` | Deselect |
| `Delete` | Delete selected note |
| `Ctrl + S` | Save module |
| `Ctrl + O` | Open module |

Check the [changelog](/about/changelog) for updates on new keyboard shortcuts.
