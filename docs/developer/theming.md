---
title: Theming
description: The developer view of the RMT Compose theme system — token schema, preset ∪ overrides resolution, the --rmt-* CSS projection, and the renderer's setConfig / setThemeColors paths.
---

# Theming

A theme in RMT Compose is a flat map of **16 colour tokens** plus **three note-geometry numbers**.
The theme manager resolves the active theme from three layers, then projects it into two completely
different targets: **CSS custom properties** for every piece of DOM chrome, and the **WebGL
renderer** for the canvas.

This page is the developer view. For what the controls do, see
[Themes & Appearance](/user-guide/interface/themes) and the
[Settings reference](/reference/settings-reference).

## The pieces

| File | Role |
|---|---|
| `src/theme/presets.js` | Pure data. Four presets, `THEME_PRESETS`, `DEFAULT_THEME_ID`, `getPreset(id)`. No DOM or GL imports, so it is safe to import from anywhere. |
| `src/theme/theme-manager.js` | The `themeManager` singleton. Resolves, writes CSS vars, calls the renderer. |
| `src/settings/settings-schema.js` | `defaultSettings()` / `validateSettings()` — the source of truth for appearance defaults and clamps. |
| `src/settings/settings-store.js` | Persistence to `localStorage["rmt:settings:v1"]`, dot-path `get`/`set`, subscriptions. |
| `src/settings/settings-panel.js` | The Appearance tab, including `COLOR_TOKEN_GROUPS` — the 15 pickers. |
| `src/renderer/webgl2/renderer.js` | `setConfig()`, `setThemeColors()`, and every draw call that reads a themed colour. |
| `src/renderer/webgl2/renderer-config.js` | `defaultRendererConfig` + `normalizeRendererConfig()` deep-merge. |
| `public/styles.css` | The `:root { --rmt-* }` literal defaults, and every DOM rule that consumes them. |

`player.js` wires it up once the GL workspace exists:

```javascript
themeManager.init({ renderer, requestResync: () => { /* glWorkspace.sync(...) + createMeasureBars() */ } });
```

`init()` applies the theme immediately, then subscribes to `settingsStore` and re-applies on any
change whose `path` is `''`, `'appearance'`, or starts with `'appearance'`.

## The token schema

A `ThemePreset` is `{ id, name, tokens, geometry }` (`presets.js:20`).

**Colour tokens** (all `#rrggbb` strings):

| Group | Tokens |
|---|---|
| Interface | `accent`, `accentText`, `bg`, `surface`, `surfaceBorder`, `textPrimary`, `textSecondary`, `danger` |
| Workspace | `noteBorder`, `playhead`, `measureBar`, `selectionRing`, `hoverRing` |
| Dependency highlights | `depFrequency`, `depStartTime`, `depDuration` |

**Non-colour tokens**, present in every preset: `noteDefaultSaturation` (a number) and
`newNoteColorMode` (`'random'` in all four presets).

::: warning Neither non-colour token is read by anything.
New notes always get `hsla(<random 0–360>, 70%, 60%, 0.7)` (`player.js:2391`, `player.js:4017`).
There is no "new note colour mode" setting anywhere in the UI. Note *body* colours are per-note user
data, not theme data, and are deliberately not themed.
:::

**Geometry:**

```javascript
geometry: { noteHeightWU: 22, borderPxAtZoom1: 1, roundedCornerPxAtZoom1: 6 }
```

## Resolution: preset ∪ overrides ∪ geometry

`themeManager.resolve()` (`theme-manager.js:101`) returns `{ id, tokens, geometry }`:

```javascript
const appearance = settingsStore.get('appearance') || {};
const preset = getPreset(appearance.themeId);            // unknown id → classic-orange
const tokens = { ...preset.tokens, ...(appearance.overrides || {}) };

const noteCfg = appearance.note || {};
const geometry = {
  noteHeightWU:           noteCfg.heightWU               ?? preset.geometry.noteHeightWU,
  borderPxAtZoom1:        noteCfg.borderPxAtZoom1        ?? preset.geometry.borderPxAtZoom1,
  roundedCornerPxAtZoom1: noteCfg.roundedCornerPxAtZoom1 ?? preset.geometry.roundedCornerPxAtZoom1,
};
```

`appearance.overrides` is a **sparse diff** — only the tokens the user actually touched. That is
exactly why the preset dropdown clears `overrides` before writing the new `themeId`
(`settings-panel.js:258-263`): layering an old override map over a new preset would show a mixture.

The stored shape:

```json
{
  "version": 1,
  "appearance": {
    "themeId": "classic-orange",
    "overrides": { "accent": "#ff00aa" },
    "note": { "heightWU": 22, "borderPxAtZoom1": 1, "roundedCornerPxAtZoom1": 6 }
  }
}
```

::: warning The geometry `??` fallback is dead code.
`validateSettings()` *always* fills `appearance.note.*` with a clamped number (defaults 22 / 1 / 6),
so those three values are never `null` or `undefined` and the preset's geometry can never win. The
`high-contrast` preset declares `borderPxAtZoom1: 2, roundedCornerPxAtZoom1: 4` — and switching to
it changes nothing. Only the three sliders change note geometry.
:::

Overrides are **not validated**: `validateSettings` copies `appearance.overrides` verbatim
(`settings-schema.js:155`). No key whitelist, no hex check. Garbage keys are stored harmlessly; a
value that is not `#rrggbb` shows as `#000000` in the picker.

## Projection 1: CSS custom properties

`_applyCssVars(tokens)` (`theme-manager.js:122`) walks `CSS_VAR_MAP` (`theme-manager.js:50-67`) and
writes each token onto `document.documentElement.style` as `--rmt-<kebab>`:

| Token | CSS var |
|---|---|
| `accent` | `--rmt-accent` |
| `accentText` | `--rmt-accent-text` |
| `bg` | `--rmt-bg` |
| `surface` | `--rmt-surface` |
| `surfaceBorder` | `--rmt-surface-border` |
| `textPrimary` | `--rmt-text-primary` |
| `textSecondary` | `--rmt-text-secondary` |
| `danger` | `--rmt-danger` |
| `noteBorder` | `--rmt-note-border` |
| `playhead` | `--rmt-playhead` |
| `measureBar` | `--rmt-measure-bar` |
| `selectionRing` | `--rmt-selection-ring` |
| `hoverRing` | `--rmt-hover-ring` |
| `depFrequency` / `depStartTime` / `depDuration` | `--rmt-dep-frequency` / `--rmt-dep-start-time` / `--rmt-dep-duration` |

It then derives **three RGB component triplets** so that translucent forms work without a second
token:

```javascript
setRgb('--rmt-accent-rgb', tokens.accent);   //  →  "255, 168, 0"
setRgb('--rmt-bg-rgb',     tokens.bg);
setRgb('--rmt-danger-rgb', tokens.danger);
```

```css
/* which is what makes this possible */
box-shadow: 0 0 12px rgba(var(--rmt-accent-rgb), 0.6);
background: rgba(var(--rmt-bg-rgb), 0.88);
```

`public/styles.css:10-32` declares the same 16 vars literally in `:root` with the *classic-orange*
values, so the app looks right before any JS runs.

### Which CSS vars actually have consumers

Writing a var is not the same as anyone reading it. Today:

| CSS var | Consumed? |
|---|---|
| `--rmt-accent`, `--rmt-accent-rgb` | **Yes** — heavily (styles.css, menu-bar, variable-controls, settings-panel) |
| `--rmt-bg`, `--rmt-bg-rgb` | **Yes** — body background, translucent bars and panels |
| `--rmt-danger`, `--rmt-danger-rgb` | **Yes** — heavily |
| `--rmt-text-primary`, `--rmt-text-secondary` | **Yes** |
| `--rmt-surface-border` | **Yes** — settings inputs, chips, buttons, menu bar |
| `--rmt-surface` | **No consumers.** Panels use `rgba(var(--rmt-bg-rgb), 0.88)` instead |
| `--rmt-accent-text` | **No consumers**, and no picker |
| `--rmt-note-border`, `--rmt-playhead`, `--rmt-measure-bar`, `--rmt-selection-ring`, `--rmt-hover-ring`, `--rmt-dep-*` | No CSS consumers by design — these are GL concerns, delivered through the renderer path below |

## Projection 2: the WebGL renderer

`_applyRenderer(geometry, tokens)` (`theme-manager.js:143`) calls **two** different renderer methods.
They are not interchangeable.

### `renderer.setConfig(partial)` — geometry and the playhead

`renderer.js:330`. Deep-merges a partial into `this._config` (via `normalizeRendererConfig`) and sets
`needsRedraw`. The theme manager sends note geometry and the playhead colour, because the playhead is
already config-driven:

```javascript
renderer.setConfig({
  note: {
    heightWU:               geometry.noteHeightWU,
    borderPxAtZoom1:        geometry.borderPxAtZoom1,
    roundedCornerPxAtZoom1: geometry.roundedCornerPxAtZoom1,
  },
  playhead: { color: hexToRgba(tokens.playhead || tokens.accent) },  // [r,g,b,a] floats 0..1
});
```

### `renderer.setThemeColors(colors)` — structural GL colours

`renderer.js:345`. Takes **hex strings**, converts to RGBA float arrays, and stores them on
`this._themeColors`. It also clears `_octaveLabelCache` and bumps `_colorEpoch` **and** `_viewEpoch`,
because canvas-textured labels are cached by string key with no colour in the key — without the
invalidation they would keep rendering in the old accent.

```javascript
renderer.setThemeColors({
  accent, noteBorder, measureBar, selectionRing, hoverRing,
  depFrequency, depStartTime, depDuration,
});
```

Reads go through accessors with baked fallbacks — `_accentRgba()`, `_accentHex()`,
`_noteBorderRgba()`, `_measureBarRgb()` (`renderer.js:378-381`) — so the renderer draws correctly
even if `setThemeColors` was never called.

| Method | Input | Effect | Triggers a re-sync? |
|---|---|---|---|
| `setConfig` | nested partial of `defaultRendererConfig` | deep-merge into `_config`; `needsRedraw = true` | No (the theme manager decides — see below) |
| `setThemeColors` | flat map of hex strings | store RGBA on `_themeColors`; clear label cache; bump `_colorEpoch` + `_viewEpoch` | No |

### The resync gate

Note rects are computed inside `sync()`, so a geometry change needs a full rebuild. A colour change
does not. The theme manager therefore fires `requestResync()` **only when the geometry key actually
changed** (`theme-manager.js:176-180`):

```javascript
const geoKey = `${geometry.noteHeightWU}:${geometry.borderPxAtZoom1}:${geometry.roundedCornerPxAtZoom1}`;
if (geoKey !== this._lastGeometryKey) {
  this._lastGeometryKey = geoKey;
  if (this._requestResync) this._requestResync();
}
```

Colour pickers fire on the `input` event — continuously while the user drags the colour wheel — so
this gate is what keeps that cheap. See [Performance](/developer/performance) for what `sync()`
actually costs.

### What is themed on the canvas

| GL element | Token | Source |
|---|---|---|
| Note body **border** (every note, not just the base) | `noteBorder` | `renderer.js:2710` |
| Silence dashed ring | `noteBorder` | `renderer.js:7284`, `:7518` |
| BaseNote circle fill | `accent` | `renderer.js:5342` |
| BaseNote circle border | `noteBorder` | `renderer.js:5343` |
| Octave / base guide lines | `accent` (alpha 0.9 primary, 0.35 secondary) | `renderer.js:8894`, `:9337` |
| Note ID labels | `accent` | `renderer.js:6944-6949` |
| BaseNote fraction label | `accent` | `renderer.js:6054` |
| Octave-guide + measure-triangle ID labels | `accent` | `renderer.js:7664`, `:7717` |
| Measure bars — dashed interior | `measureBar` @ alpha 0.35 | `renderer.js:4981` |
| Measure bars — solid start/end | `measureBar` @ alpha 0.8 | `renderer.js:5167` |
| Playhead line | `playhead`, via `config.playhead.color` | `renderer.js:3034` |
| Marquee rectangle (multi-select drag) | `selectionRing` | `renderer.js:10833` |
| Note height / border px / corner px | `appearance.note.*` | `theme-manager.js:151-158` |

### What is baked and cannot be themed

These are shader literals or per-note user data. `setThemeColors` may *store* the corresponding
token, but nothing reads it.

| GL element | Colour | Source |
|---|---|---|
| Note body **fill** | per-note user data (`note.color`) | `player.js:2391` |
| Selected-note ring | white `(1,1,1,1)` | `renderer.js:2913` |
| Selected-note fill wash | white @ 0.12 | `renderer.js:2870` |
| Hover ring | white (0.6 alpha when it coincides with the selection) | `renderer.js:2988` |
| Multi-select group ring | white, 4 px (`selection.multiRingThicknessPxAtZoom1 ?? 4.0` — the key is not in `defaultRendererConfig`, so 4.0 is the effective default) | `renderer.js:1521-1526` |
| Dependency-highlight rings | orange `(1,.5,0)`, cyan `(0,1,1)`, purple `(.615,0,1)` | `renderer.js:2774-2792` |
| Measure-triangle outlines | teal / purple / white | `renderer.js:5842-5991` |
| On-note fraction digits, "silence", ▲/▼ glyphs | white | `renderer.js:6982`, `:7072-7088`, `:7196-7211` |

::: danger Four of the fifteen colour pickers currently do nothing.
`hoverRing`, `depFrequency`, `depStartTime` and `depDuration` are stored on `_themeColors` and never
read; the rings are drawn from hardcoded literals. `surface` is written to `--rmt-surface`, which has
zero consumers. And `selectionRing` does **not** recolour the selected note's ring (that is
hardcoded white) — it only tints the **marquee rectangle**. These are bugs, not design. Do not build
on the assumption that they work.
:::

![The Appearance tab of the Settings panel: theme dropdown, three geometry sliders, and fifteen colour pickers grouped into Interface, Workspace and Dependency highlights](/img/settings-appearance.png)

## Adding a new theme token, end to end

Say you want a themeable **hover ring** that actually works.

1. **Add the token to every preset** in `src/theme/presets.js`. All four, or `resolve()` will
   produce `undefined` for the presets that lack it. (`hoverRing` already exists — for a genuinely
   new token, add it here.)

2. **Decide who consumes it.**
   - *DOM* → add it to `CSS_VAR_MAP` (`theme-manager.js:50-67`), then `var(--rmt-your-token)` in
     `public/styles.css`. Also add a literal default under `:root` (`styles.css:10-32`) so the app
     looks right before JS boots. If you need `rgba(...)` forms, add a `setRgb(...)` line in
     `_applyCssVars`.
   - *GL* → pass it through `_applyRenderer`'s `setThemeColors({ ... })` call
     (`theme-manager.js:163-172`), accept it in `setThemeColors` (`renderer.js:345`) with a baked
     fallback matching today's literal, and add an accessor next to `_accentRgba()` /
     `_noteBorderRgba()` (`renderer.js:378-381`).

3. **Make the draw path read the accessor** instead of the literal. For the hover ring that means
   replacing `gl.uniform4f(uCol, 1.0, 1.0, 1.0, a)` (`renderer.js:2988`) with the themed RGBA,
   keeping the existing alpha logic.

4. **Add a picker** — one entry in `COLOR_TOKEN_GROUPS` (`settings-panel.js:40-53`):

   ```javascript
   { title: 'Workspace', tokens: [
     ['noteBorder', 'Note border'], /* … */ ['hoverRing', 'Hover ring'],
   ]},
   ```

   `colorRow()` handles the rest: it seeds from `effectiveColor(token)` (preset overlaid with
   override), writes `appearance.overrides.<token>` on every `input` event, and re-seeds itself
   through `addSync` when the preset changes or "Reset colors to theme" is pressed. No schema change
   is needed — `overrides` is a free-form map.

5. **Verify against a pixel diff, not your eyes.** Canvas-textured labels are cached by string key
   with no colour in it; if your token feeds one, `setThemeColors` must invalidate that cache (it
   already clears `_octaveLabelCache` and bumps `_colorEpoch` / `_viewEpoch`). Run
   `node scripts/perf/visual-regress.mjs --compare --url http://localhost:3000` and switch presets
   in a real browser. `node scripts/perf/shot-settings.mjs` drives the panel headlessly.

::: tip Skipping step 3 is exactly how the four dead pickers happened.
A token can be defined, persisted, mapped to a CSS var, handed to `setThemeColors` and given a
picker — and still do nothing, because no draw call reads it. Wiring the consumer is the step that
counts.
:::

## Adding a new preset

Add the object to `src/theme/presets.js` and register it in `THEME_PRESETS`:

```javascript
const MY_THEME = {
  id: 'my-theme',
  name: 'My Theme',
  tokens: { /* all 16 colour tokens + noteDefaultSaturation + newNoteColorMode */ },
  geometry: { noteHeightWU: 22, borderPxAtZoom1: 1, roundedCornerPxAtZoom1: 6 },
};

export const THEME_PRESETS = { /* … */, 'my-theme': MY_THEME };
```

The Appearance dropdown is built from `Object.values(THEME_PRESETS)`, so it appears with no UI
change. Ship **every** colour token: a missing one resolves to `undefined` and the CSS var is simply
not written (`_applyCssVars` only sets string values), leaving the previous theme's value on
`<html>`. Do not bother tuning `geometry` — see the dead-fallback warning above.

`getPreset(id)` falls back to `classic-orange` for an unknown id (`presets.js:142`), so a stale
`themeId` in someone's localStorage degrades quietly rather than crashing.

## The four shipped presets

`classic-orange` is the default and is deliberately pixel-identical to the pre-theme app — its values
were read straight out of the old shader and CSS literals.

| id | Name | `accent` | `bg` | `noteBorder` |
|---|---|---|---|---|
| `classic-orange` | Classic Orange | `#ffa800` | `#151525` | `#636363` |
| `slate-cyan` | Slate Cyan | `#38bdf8` | `#0b1120` | `#5a6a85` |
| `mono-light` | Mono Light | `#d17400` | `#f5f5f0` | `#9a9a92` |
| `high-contrast` | High Contrast | `#ffd400` | `#000000` | `#ffffff` |

Full token tables are in the [Settings reference](/reference/settings-reference).

## Gotchas

- **There is no OS light/dark detection.** No `prefers-color-scheme` handling for app theming
  anywhere. `mono-light` is chosen by hand or not at all.
- **There is a boot flash.** The `:root` literals in `styles.css` are classic-orange, and
  `themeManager.init()` only runs once the GL workspace exists (`player.js:1195`). A user on
  `mono-light` sees a brief dark/orange flash on every load. Do not promise flicker-free theming.
- **Selecting a preset silently discards every colour override**, with no confirmation. Only the
  explicit "Reset colors to theme" button asks first.
- **There is no theme import/export and no custom named themes.** Four presets plus a flat override
  map is the whole surface.
- **`geometry` in a preset is inert** (see above). Note height, border and corner radius come only
  from the three Appearance sliders, clamped to `[8, 60]`, `[0, 6]` and `[0, 20]`.
- **Note height is the master dimension for on-note overlays.** The ID label, fraction text, arrow
  column and pull tab are all sized as factors of it (`renderer-config.js:61-74`), so a geometry
  change is never just a note-body change.

## See also

- [Themes & Appearance](/user-guide/interface/themes) — the user-facing tour
- [Settings](/user-guide/interface/settings)
- [Settings reference](/reference/settings-reference)
- [Performance](/developer/performance) — why colour edits do not re-sync
- [WebGL2 renderer](/developer/rendering/webgl2-renderer)
