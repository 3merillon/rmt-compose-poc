# Theming the interface and score

`src/theme/presets.ts` defines Classic Orange, Slate Cyan, Mono Light and High Contrast. `themeManager.resolve()` in `src/theme/theme-manager.ts` combines the active preset with the user’s colour overrides and stored geometry. The controls, token names, ranges and preset values are listed in [Settings reference](/reference/settings-reference#theme-tokens).

## DOM and canvas

The theme manager writes CSS custom properties to the document root for the interface. It separately sends the structural colours to the renderer, including the note border, measure bars, selection and hover rings, dependency colours and glyph text. A CSS change alone cannot recolour a note drawn by a shader.

`setConfig` receives height, border thickness, corner radius, envelope mode, tail visibility, detail cutoff and playhead colour. The theme manager resolves **Never** to an infinite count cutoff. Colour changes invalidate display colours and cached labels. The geometry resync key includes note height, border, radius, envelope mode and tails. The detail cutoff can change the detail pass without rebuilding the score’s note positions.

## Changing a preset

Check the panel and canvas together. Select a note with pitch and timing dependencies, inspect a measure, hover a note, then switch to a light and a high-contrast preset. Verify that note text redraws, dependency colours are distinct and the control remains legible. The score’s own note colours are separate from theme tokens. [Themes and appearance](/user-guide/interface/themes)
