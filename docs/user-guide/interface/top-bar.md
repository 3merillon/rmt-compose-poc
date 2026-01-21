# Top Bar

The **Top Bar** contains transport controls, playback settings, and access to the main menu.

## Layout

From left to right:

| Element | Description |
|---------|-------------|
| Play/Pause | Start or pause playback |
| Stop | Stop playback and reset to beginning |
| Volume | Adjust playback volume |
| Reset View | Center workspace on BaseNote |
| Tracking | Toggle playhead tracking mode |
| Menu | Open the main menu |
| Lock | Toggle note editing lock |

## Transport Controls

### Play/Pause Button

A single button that toggles between states:
- **Play (▶)**: Starts playback from the current position
- **Pause (⏸)**: Button transforms to pause icon during playback; click to pause
- **Resume**: Click the play button again to continue from where you paused

### Stop Button

- **Stop (■)**: Halts playback completely
- **Reset**: The playhead returns to the beginning (time = 0)

### Volume Slider

- **Range**: 0 (muted) to 1 (full volume)
- **Real-time**: Adjustments take effect immediately during playback

::: tip
Start with a lower volume when exploring new modules - some can be surprisingly loud!
:::

## View Controls

### Reset View Button

- **Function**: Centers the workspace on the BaseNote
- **Disabled when**: Playhead tracking is enabled (tracking controls the view)

### Tracking Toggle

When enabled:
- The workspace automatically scrolls to keep the playhead centered
- Reset View button is disabled
- Useful for long compositions

When disabled:
- The workspace stays fixed
- Playhead moves across the static view
- You can pan and zoom freely

## Main Menu

Click the **hamburger icon (☰)** to open the main menu.

### Menu Options

| Option | Description |
|--------|-------------|
| **Undo** | Undo the last change |
| **Redo** | Redo the last undone change |
| **Reorder Module** | Reindex notes by start time (measures first, then notes) |
| **Save Module** | Export the current module as JSON |
| **Load Module** | Import a module from file (replaces current workspace) |

### Undo/Redo

- **Undo (Ctrl/Cmd + Z)**: Reverts the most recent change
- **Redo (Ctrl/Cmd + Y)**: Reapplies an undone change
- **History limit**: Up to 50 states are remembered

### Save Module

1. Click **Save Module**
2. A JSON file (`module.json`) downloads to your computer

### Load Module

Opens a submenu with options:

| Option | Description |
|--------|-------------|
| **Load from file** | Opens a file picker to select a JSON module |
| **Reset to Default Module** | Loads the built-in default composition (Bach's Neverending Canon) |

::: warning
Loading a module replaces the current workspace content. Save your work first if needed!
:::

## Lock Button

The lock icon toggles note editing:

- **Unlocked (🔓)**: Notes can be moved, resized, and edited
- **Locked (🔒)**: Notes are view-only; prevents accidental changes

This is useful when:
- Presenting a composition
- Exploring without making changes
- Preventing accidental modifications to a finished piece

## Footer Links

At the bottom of the menu:

| Link | Destination |
|------|-------------|
| **Documentation** | Full documentation site (docs.rmt.world) |
| **Donate** | Support the project (Stripe) |
| **License** | View the RMT-PNC license |

## Keyboard Shortcuts

These shortcuts work anywhere in the app:

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + Y` | Redo |

## Tips

1. **Use keyboard shortcuts** for undo/redo - it's faster than opening the menu
2. **Save to file for backup** - the current module persists in browser storage across reloads, but saving to a file is more secure if you clear browser data
3. **Enable tracking** for long compositions you want to follow during playback
4. **Lock when presenting** to avoid accidental edits during demonstrations
