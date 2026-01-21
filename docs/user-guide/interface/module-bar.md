# Module Bar

The **Module Bar** is a categorized library of preset and custom modules that you can drag onto the workspace.

## Overview

Located below the top bar, the Module Bar displays:

- **Categories**: Organized groups of modules (Intervals, Chords, Melodies, Custom)
- **Module icons**: Draggable items representing each module
- **Add/Delete controls**: Manage your module library

## Categories

### Built-in Categories

| Category | Description |
|----------|-------------|
| **Intervals** | Single intervals (octave, fifth, third, etc.) |
| **Chords** | Common chord voicings (major, minor, etc.) |
| **Melodies** | Example sequences including TET scales |
| **Custom** | Your personal module library |

### Category Controls

- **Reorder**: Drag categories to change their order
- **Add Category**: Click the "+" button to create a new category
- **Delete Category**: Click the red "×" on a category to remove it (and its modules)

::: warning
Deleting a category removes all modules within it. This action cannot be undone.
:::

## Using Modules

### Drop Mode Toggle

At the top of the Module Bar, you'll find a **Drop at:** toggle with two options:

| Mode | Description |
|------|-------------|
| **Start** | Module notes are placed at the **beginning** of the target note |
| **End** | Module notes are placed at the **end** of the target note |

This toggle controls where module notes land when dropped onto a note:

- **Start mode**: Notes referencing `base.t` are remapped to start at the target note's start time (`[target].t`)
- **End mode**: Notes referencing `base.t` are remapped to start at the target note's end (`[target].t + [target].d`)

::: tip
Use **End** mode to chain modules sequentially—drop a module onto the last note and it will appear right after it.
:::

### Drag and Drop a Module

1. Select the desired **drop mode** (Start or End) using the toggle
2. Find the module you want in the Module Bar
3. **Drag** the module icon onto the workspace
4. Drop it onto a note or measure bar

The module's dependencies are remapped from its original BaseNote to the drop target:
- **Drop on a note or BaseNote**: All properties (start time, duration, frequency) are remapped relative to that note
- **Drop on a measure bar**: Start time and duration are remapped relative to the measure; frequency is remapped relative to the workspace's BaseNote
- **Drop on a silence**: Not currently supported

### Module Tooltip

Hover over a module icon to see its name in a tooltip.

## Managing Modules

### Loading Modules into the Library

1. Find the category where you want to add the module
2. Click the **"+"** icon (add placeholder) in that category
3. Select a JSON module file from your computer
4. The module appears in the category and can be dragged onto the workspace

### Removing Modules

1. Click the red **"×"** on any module icon
2. Confirm the deletion
3. The module is removed from the library

### Reordering Modules

1. Click and hold a module icon
2. Drag to a new position within the same category or to a different category
3. Release to place the module

### Creating Custom Categories

1. Click **"Add Category"** button
2. Enter a name for the category
3. The new category appears in the Module Bar
4. Add modules by dragging or using the "+" placeholder

## Persistence

### Automatic Saving

The Module Bar state is saved to your browser's LocalStorage:
- Category order
- Module positions within categories
- Custom modules added

**Auto-save triggers**:
- Every 30 seconds
- When the page is closed/refreshed
- After any change to the module bar (adding, removing, reordering)

### Manual Save/Load

- **Save UI**: Export your entire Module Bar configuration to a JSON file
- **Load UI**: Import a previously saved configuration
- **Reload Defaults**: Reset to the original factory configuration

::: tip
Use "Save UI" before clearing browser data to preserve your custom module organization.
:::

## Resizing

The Module Bar can be resized:

1. Find the **pull tab** at the bottom of the Module Bar
2. Drag up or down to resize

## File Locations

For local development, modules are stored in:

```
public/modules/
├── intervals/
│   ├── index.json
│   ├── octave.json
│   └── ...
├── chords/
│   ├── index.json
│   ├── major.json
│   └── ...
├── melodies/
│   ├── index.json
│   ├── TET-12.json
│   └── ...
├── custom/
│   ├── index.json
│   └── ...
└── defaultModule.json
```

### Adding Modules Permanently

To add a module that persists across all users:

1. Create your module JSON file
2. Place it in the appropriate category folder (e.g., `public/modules/custom/`)
3. Edit that category's `index.json` to reference your file:

```json
{
  "custom": [
    { "file": "my-module.json", "label": "My Module" }
  ]
}
```

4. Restart the dev server or refresh the app

## Tips

1. **Organize by workflow**: Create categories for different projects or styles
2. **Use descriptive file names**: Module labels are currently derived from file names, so name your JSON files clearly
3. **Back up regularly**: Use "Save UI" to preserve your library
4. **Start from presets**: Load an existing module and modify it rather than starting from scratch
