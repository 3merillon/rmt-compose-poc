# Loading Modules

Learn how to import modules into your workspace.

## Methods of Loading

### Method 1: Drag from Module Bar

The quickest way to load a module:

1. Open the **Module Bar** (below the top bar)
2. Find the module you want
3. **Drag** it onto the workspace
4. Release to load

### Method 2: Load from File

Load a module from your computer:

1. Click the **Menu** (☰) in the top bar
2. Select **Load Module**
3. Click **Load from file**
4. Select a JSON file from your computer
5. The module loads into the workspace

### Method 3: Reset to Default

Load the built-in default module:

1. Click the **Menu** (☰)
2. Select **Load Module**
3. Click **Reset to Default Module**

## Built-in Modules

RMT Compose includes several categories of preset modules:

### Intervals

Simple two-note intervals:
- **octave** - 2:1 ratio
- **5th** - 3:2 (perfect fifth)
- **4th** - 4:3 (perfect fourth)
- **major 3rd** - 5:4
- **minor 3rd** - 6/5

### Chords

Common chord voicings:
- **major** - Major triad (1, 5/4, 3/2)
- **minor** - Minor triad (1, 6/5, 3/2)

### Melodies

Example sequences and scales:
- **TET-12** - Chromatic scale in 12-TET
- **TET-19** - 19-TET scale
- **TET-31** - 31-TET scale
- **BP-13** - Bohlen-Pierce scale
- Various melodic examples

### Custom

Your personal module library (initially empty).

## What Happens When You Load

When you load a module:

1. **Current workspace is replaced** - All existing notes are removed
2. **BaseNote is set** - From the module's baseNote definition
3. **Notes are created** - From the module's notes array
4. **Expressions are compiled** - To binary bytecode
5. **Dependencies are calculated** - The dependency graph is built
6. **Rendering updates** - The workspace displays the new content

::: warning
Loading a module replaces everything in the workspace. Save your current work first if needed!
:::

## Module File Format

Modules are JSON files with this structure:

```json
{
  "baseNote": {
    "frequency": "new Fraction(440)",
    "startTime": "new Fraction(0)",
    "tempo": "new Fraction(120)",
    "beatsPerMeasure": "new Fraction(4)"
  },
  "notes": [
    {
      "id": 1,
      "frequency": "...",
      "startTime": "...",
      "duration": "...",
      "color": "rgba(...)",
      "instrument": "sine-wave"
    }
  ]
}
```

See [Module Format](./module-format) for complete schema documentation.

## Troubleshooting

### Module won't load

- Check that it's a valid JSON file
- Ensure the file follows the module schema
- Look for syntax errors in expressions
- Check browser console for error messages

### Notes appear in wrong positions

- Verify expression syntax is correct
- Check for circular dependencies
- Ensure referenced note IDs exist

### No sound when playing

- Check that notes have valid frequency expressions
- Verify startTime and duration are set
- Ensure the module has at least one note

## Tips

1. **Preview before loading** - Read the module name and description
2. **Save first** - Export your current work before loading a new module
3. **Start from presets** - Load a built-in module and modify it
4. **Use the Module Bar** - It's faster than file loading for common modules
