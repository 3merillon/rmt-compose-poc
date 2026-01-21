# Saving Modules

Learn how to export your compositions as reusable module files.

## Saving Your Work

### Quick Save

1. Click the **Menu** button (plus/minus icon) in the top bar
2. Click **Save Module**
3. A JSON file downloads to your computer

## What Gets Saved

When you save a module, the JSON file contains:

| Component | Description |
|-----------|-------------|
| **baseNote** | BaseNote properties (frequency, tempo, etc.) |
| **notes** | All notes with their expressions |
| **measures** | Measure bar positions (if any) |

### Expressions Are Preserved

The **raw expressions** are saved, not evaluated values:

```json
{
  "frequency": "module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))"
}
```

This means:
- Dependencies are preserved
- Loading in a different context works correctly
- Changing BaseNote after loading affects all notes

## File Location

The saved file goes to your browser's default download location:
- **Windows**: Usually `Downloads` folder
- **macOS**: Usually `Downloads` folder
- **Linux**: Usually `~/Downloads`

## Adding to Module Bar

To make your module appear in the Module Bar:

### Method 1: UI Upload

1. Open the **Module Bar**
2. Find the category where you want the module
3. Click the **+** placeholder
4. Select your saved JSON file
5. The module appears in that category

### Method 2: Manual Installation (Local Development)

1. Copy your JSON file to a category folder:
   ```
   public/modules/custom/my-module.json
   ```

2. Edit the category's `index.json`:
   ```json
   {
     "custom": [
       { "file": "my-module.json", "label": "My Module" }
     ]
   }
   ```

3. Restart the dev server or refresh

## Best Practices

### Naming

Choose descriptive names for your modules:
- ✓ `major-seventh-chord.json`
- ✓ `chromatic-melody-dmaj.json`
- ✗ `test.json`
- ✗ `asdfasdf.json`

### Organization

Keep modules organized:
- Use categories meaningfully
- Group related modules together
- Delete old/unused modules

### Documentation

Consider adding comments in your module (JSON doesn't support comments, but you can add a `_description` field):

```json
{
  "_description": "A major seventh chord in just intonation",
  "baseNote": { ... },
  "notes": [ ... ]
}
```

## Sharing Modules

Modules are portable JSON files that can be shared:

### Email

Attach the JSON file to an email.

### Cloud Storage

Upload to Google Drive, Dropbox, etc., and share the link.

### GitHub

Create a repository of your modules for public sharing.

### Direct Loading

Recipients can load your module via:
1. **Menu > Load Module > Load from file**
2. Or add to their Module Bar

No special software or account required - just the JSON file!

::: danger Security Warning
**Only load modules from sources you trust.** Module expressions are executed as code when loaded. A malicious module could potentially access browser data or perform unwanted actions. Never load modules from unknown or untrusted sources.
:::

## Versioning

For modules you iterate on:

1. **Save with version numbers**: `my-song-v1.json`, `my-song-v2.json`
2. **Keep backups**: Don't overwrite previous versions
3. **Use git**: Version control for serious module development

## Export vs Save UI

| Feature | Save Module | Save UI |
|---------|-------------|---------|
| **Saves** | Current composition | Module Bar layout |
| **Format** | Single module JSON | UI state JSON |
| **Use case** | Share/archive a piece | Preserve your library organization |

**Save Module**: Exports what's in the workspace.
**Save UI**: Exports your Module Bar organization.

## Tips

1. **Save frequently** - There's no auto-save
2. **Use descriptive names** - You'll thank yourself later
3. **Keep backups** - Especially for important compositions
4. **Test after saving** - Load the file to verify it works
5. **Use Reorder Module** - Before sharing, click **Reorder Module** to renumber notes sequentially
6. **Only share trusted modules** - When sharing, only distribute modules you created or verified yourself
