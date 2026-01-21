# Loading Modules

Learn how to replace the workspace with a module from a file.

::: danger Security Warning
**Only load modules from sources you trust.** Module expressions are executed as code when loaded. A malicious module could potentially access browser data or perform unwanted actions. Never load modules from unknown or untrusted sources.
:::

## Loading from Menu

### Load from File

Load a module JSON file from your computer:

1. Click the **Menu** button (plus/minus icon) in the top bar
2. Click **Load Module** to expand the dropdown
3. Click **Load Module from file…**
4. Select a JSON file from your computer
5. The **entire workspace is replaced** with the module contents

::: warning
Loading a module **replaces everything** in the workspace. All existing notes are removed. Save your current work first if needed!
:::

### Reset Default Module

Reset to the built-in default module (Bach's Neverending Canon):

1. Click the **Menu** button (plus/minus icon) in the top bar
2. Click **Load Module** to expand the dropdown
3. Click **Reset Default Module**
4. The workspace is replaced with the default module

## Loading into Module Bar

You can add module files to the Module Bar for quick access:

1. Expand the **Module Bar** (drag the pull tab below the top bar)
2. Find the category where you want to add the module
3. Click the **+** placeholder at the end of that category
4. Select a JSON file from your computer
5. The module appears in that category

Modules added this way are saved in your browser's local storage and persist across sessions.

See [Module Bar](../interface/module-bar) for more details on organizing and using the Module Bar.

## What Happens When You Load

When you load a module via the menu:

1. **Current workspace is cleared** - All existing notes are removed
2. **BaseNote is set** - From the module's baseNote definition
3. **Notes are created** - From the module's notes array
4. **Expressions are compiled** - To binary bytecode
5. **Dependencies are calculated** - The dependency graph is built
6. **Rendering updates** - The workspace displays the new content

## Module File Format

Modules are JSON files with this structure:

```json
{
  "baseNote": {
    "frequency": "440",
    "startTime": "0",
    "tempo": "120",
    "beatsPerMeasure": "4"
  },
  "notes": [
    {
      "id": 1,
      "frequency": "base.f * (3/2)",
      "startTime": "base.t",
      "duration": "beat(base)",
      "color": "rgba(255, 100, 100, 0.7)",
      "instrument": "sine-wave"
    }
  ]
}
```

<details>
<summary>Legacy JavaScript syntax (also supported)</summary>

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
      "frequency": "module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))",
      "startTime": "module.baseNote.getVariable('startTime')",
      "duration": "new Fraction(60).div(module.findTempo(module.baseNote))",
      "color": "rgba(255, 100, 100, 0.7)",
      "instrument": "sine-wave"
    }
  ]
}
```
</details>

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

1. **Save first** - Export your current work before loading a new module
2. **Start from saves** - Load a previously saved module or one from the default set, then modify it
3. **Load vs Drop** - Menu loading replaces the workspace; dragging from Module Bar integrates into it
4. **Trust the source** - Only load modules from people or sources you trust
