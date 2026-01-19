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

- **Expand/Collapse**: Click a category name to show/hide its modules
- **Reorder**: Drag categories to change their order
- **Add Category**: Click the "+" button to create a new category
- **Delete Category**: Click the red "×" on a category to remove it (and its modules)

::: warning
Deleting a category removes all modules within it. This action cannot be undone.
:::

## Using Modules

### Loading a Module

1. Find the module you want in the Module Bar
2. **Drag** the module icon onto the workspace
3. Release to load the module

The current workspace content is replaced with the loaded module.

### Module Preview

Hover over a module icon to see:
- Module name
- Brief description (if available)

## Managing Modules

### Adding Modules to the Library

1. Find the category where you want to add the module
2. Click the **"+"** icon (add placeholder) in that category
3. Select a JSON file from your computer
4. The module appears in the category

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

**Auto-save interval**: Every 30 seconds

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
3. The workspace adjusts accordingly

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
2. **Use descriptive names**: Clear labels make finding modules easier
3. **Back up regularly**: Use "Save UI" to preserve your library
4. **Start from presets**: Load an existing module and modify it rather than starting from scratch
