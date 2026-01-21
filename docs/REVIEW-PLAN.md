# Documentation Accuracy Review Plan

## Objective
Review and fix all false/invented information in documentation, ensuring it accurately reflects actual app functionality. Ensure modern DSL syntax is primary with legacy JavaScript in collapsible `<details>` sections.

## Approach
- Review each doc file against actual source code (re-examine relevant source for each page)
- Fix any invented features (e.g., "double-click workspace to create note" - doesn't exist)
- Ensure DSL syntax is used primarily
- User reviews each section batch after editing
- Mark section complete, then open new chat for next section

---

## Quick Review Checklist (Per File)

### Red Flags to Fix Immediately:
- [ ] Claims "double-click workspace to create note" (FALSE - use Variable Widget)
- [ ] Code blocks with ONLY legacy syntax (needs DSL primary + legacy in `<details>`)
- [ ] Invalid property shortcuts: `l`, `len`, `st`, `pitch` (use: `f`, `t`, `d`, `tempo`, `bpm`, `ml`)
- [ ] Missing `<details>` wrapper for legacy JavaScript code

### Valid DSL Property Shortcuts:
| Property | Valid Shortcuts |
|----------|-----------------|
| frequency | `f`, `freq`, `frequency` |
| startTime | `t`, `s`, `start`, `startTime` |
| duration | `d`, `dur`, `duration` |
| tempo | `tempo` |
| beatsPerMeasure | `bpm`, `beatsPerMeasure` |
| measureLength | `ml`, `measureLength` |

### Valid DSL Syntax Examples:
```
base.f                    # BaseNote frequency
[1].f                     # Note 1 frequency
(3/2)                     # Fraction literal
base.f * (3/2)            # Perfect fifth
[1].t + [1].d             # End time of note 1
beat(base)                # One beat duration
tempo([1])                # Get tempo for note 1
measure(base)             # Get measure length
2^(1/12)                  # 12-TET semitone
```

---

## Key Source Files to Verify Against

For each doc page, re-examine relevant source code:

| Topic | Source Files |
|-------|--------------|
| Note Creation | `src/modals/note-creation.js` |
| Variable Widget | `src/modals/variable-controls.js`, `src/modals/index.js` |
| DSL Syntax | `src/dsl/constants.js`, `src/dsl/index.js`, `src/dsl/parser.js` |
| Expressions | `src/expression-compiler.js`, `src/dsl/compiler.js` |
| Dependencies | `src/dependency-graph.js` |
| UI Interactions | `src/renderer/webgl2/renderer.js`, `src/input-handler.js` |
| Module Format | `src/module-serializer.js`, `src/module.js` |
| Playback | `src/player.js`, `src/audio/*.js` |
| Instruments | `src/audio/instrument-manager.js` |

---

## Verified Actual App Behavior

### Note Creation (ACTUAL):
1. Click BaseNote or existing note to select it
2. Variable Widget shows "Add Note" section
3. Choose type: "Note" or "Measure"
4. Choose position: "At End" or "After Selected"
5. Click "Create Note" button

**FALSE claims to fix:** "Double-click workspace to create note" - NO double-click create exists.

### DSL Syntax (ACTUAL):
- `base.f` - BaseNote frequency
- `[1].f` - Note 1 frequency
- `(3/2)` - Fraction literal
- `beat(base)` - One beat duration (60/tempo)
- `tempo([1])` - Get tempo for note
- `measure(base)` - Get measure length
- `2^(1/12)` - Power operator for TET

### Dependency Colors (ACTUAL):
- **Orange**: frequency dependents
- **Teal/Cyan**: startTime dependents
- **Purple**: duration dependents

---

## Files to Review

### Phase 0: Getting Started (Double-check)
| # | File | Status | Issues Found |
|---|------|--------|--------------|
| 0a | `docs/getting-started/index.md` | ✅ Complete | None |
| 0b | `docs/getting-started/installation.md` | ✅ Complete | None |
| 0c | `docs/getting-started/first-composition.md` | ✅ Complete | None - already had DSL + legacy details |
| 0d | `docs/getting-started/concepts.md` | ✅ Complete | Fixed: Dependency colors (was blue/red, now orange/teal/purple by property) |

### Phase 1: User Guide - Notes (High Priority)
| # | File | Status | Issues Found |
|---|------|--------|--------------|
| 1 | `docs/user-guide/notes/creating-notes.md` | ✅ Complete | Fixed: Dependency colors; Fixed UI labels ("Add Note / Silence", "At End"/"At Start"); Fixed default values; Fixed legacy code example |
| 2 | `docs/user-guide/notes/editing-notes.md` | ✅ Complete | Fixed: Removed "red" color reference; Added instrument inheritance explanation; Rewrote "Liberate Dependencies" section with proper use cases |
| 3 | `docs/user-guide/notes/dependencies.md` | ✅ Complete | Fixed: Dependency color table; Added line thickness explanation (thick=parents, thin=children); Converted patterns to DSL |
| 4 | `docs/user-guide/notes/expressions.md` | ✅ Complete | Fixed: Expression example in table (was pseudocode, now DSL) |

### Phase 2: User Guide - Interface
| # | File | Status | Issues Found |
|---|------|--------|--------------|
| 5 | `docs/user-guide/interface/workspace.md` | ✅ Complete | Fixed: Dependency colors (was Blue/Cyan & Red/Orange, now property-specific: Orange=frequency, Teal=startTime, Purple=duration); Added line thickness explanation |
| 6 | `docs/user-guide/interface/variable-widget.md` | ✅ Complete | Fixed: Legacy-only code blocks now have DSL primary + legacy in details; Fixed Add Note UI labels; Fixed Liberate Dependencies description; Fixed Add Measure (only on last measure of chain or BaseNote); Fixed Delete and Keep Dependencies (= Liberate + Delete); Fixed Dependency Highlighting (updates on save only, not real-time); Fixed ≈ Symbol (shows fractional approximation, toPrecision(8) for directly corrupted); Fixed Widget Positioning (bottom-left, user resizable, anchored to bottom); Fixed Tips (dragging/resizing, not "duration icons") |
| 7 | `docs/user-guide/interface/module-bar.md` | ✅ Complete | None - accurate |
| 8 | `docs/user-guide/interface/top-bar.md` | ✅ Complete | None - accurate |
| 9 | `docs/user-guide/interface/keyboard-shortcuts.md` | ✅ Complete | None - accurate (history limit 50 is correct) |

### Phase 3: User Guide - Modules
| # | File | Status | Issues Found |
|---|------|--------|--------------|
| 10 | `docs/user-guide/modules/module-format.md` | ✅ Complete | None - already had DSL primary + legacy in details |
| 11 | `docs/user-guide/modules/creating-modules.md` | ✅ Complete | Fixed: UI labels ("Add Note / Silence", "At End"/"At Start"); Converted all code blocks to DSL primary + legacy details; Fixed module JSON examples |
| 12 | `docs/user-guide/modules/loading-modules.md` | ✅ Complete | Fixed: Menu description; Added DSL primary format; Rewrote to distinguish Load (replaces workspace) vs Module Bar drop (integrates); Removed specific category listings (user-organized); Added Bach's Neverending Canon as default; Fixed tips |
| 13 | `docs/user-guide/modules/saving-modules.md` | ✅ Complete | Fixed: Menu description; Fixed saved format example (now shows DSL); Removed "Evaluate to BaseNote" (doesn't exist), replaced with "Reorder Module" |

### Phase 4: User Guide - Playback
| # | File | Status | Issues Found |
|---|------|--------|--------------|
| 14 | `docs/user-guide/playback/transport.md` | ⬜ Pending | |
| 15 | `docs/user-guide/playback/tracking.md` | ⬜ Pending | |
| 16 | `docs/user-guide/playback/instruments.md` | ⬜ Pending | |

### Phase 5: User Guide - Tuning
| # | File | Status | Issues Found |
|---|------|--------|--------------|
| 17 | `docs/user-guide/tuning/ratios.md` | ⬜ Pending | |
| 18 | `docs/user-guide/tuning/equal-temperament.md` | ⬜ Pending | |
| 19 | `docs/user-guide/tuning/12-tet.md` | ⬜ Pending | |
| 20 | `docs/user-guide/tuning/19-tet.md` | ⬜ Pending | |
| 21 | `docs/user-guide/tuning/31-tet.md` | ⬜ Pending | |
| 22 | `docs/user-guide/tuning/bohlen-pierce.md` | ⬜ Pending | |
| 23 | `docs/user-guide/tuning/custom-tet.md` | ⬜ Pending | |

### Phase 6: Tutorials - Beginner
| # | File | Status | Issues Found |
|---|------|--------|--------------|
| 24 | `docs/tutorials/beginner/major-scale.md` | ⬜ Pending | |
| 25 | `docs/tutorials/beginner/major-triad.md` | ⬜ Pending | |
| 26 | `docs/tutorials/beginner/rhythm.md` | ⬜ Pending | |

### Phase 7: Tutorials - Intermediate
| # | File | Status | Issues Found |
|---|------|--------|--------------|
| 27 | `docs/tutorials/intermediate/dependencies.md` | ⬜ Pending | **KNOWN: "Double-click workspace to create note"** |
| 28 | `docs/tutorials/intermediate/octaves.md` | ⬜ Pending | |
| 29 | `docs/tutorials/intermediate/measures.md` | ⬜ Pending | |
| 30 | `docs/tutorials/intermediate/index.md` | ⬜ Pending | |

### Phase 8: Tutorials - Advanced
| # | File | Status | Issues Found |
|---|------|--------|--------------|
| 31 | `docs/tutorials/advanced/complex-dependencies.md` | ⬜ Pending | |
| 32 | `docs/tutorials/advanced/microtonal.md` | ⬜ Pending | |
| 33 | `docs/tutorials/advanced/symbolic-power.md` | ⬜ Pending | |
| 34 | `docs/tutorials/advanced/index.md` | ⬜ Pending | |

### Phase 9: Tutorials - Workflows
| # | File | Status | Issues Found |
|---|------|--------|--------------|
| 35 | `docs/tutorials/workflows/intervals.md` | ⬜ Pending | |
| 36 | `docs/tutorials/workflows/module-library.md` | ⬜ Pending | |
| 37 | `docs/tutorials/workflows/microtonal-experiments.md` | ⬜ Pending | |
| 38 | `docs/tutorials/workflows/index.md` | ⬜ Pending | |

### Phase 10: Reference - Expressions
| # | File | Status | Issues Found |
|---|------|--------|--------------|
| 39 | `docs/reference/expressions/syntax.md` | ⬜ Pending | |
| 40 | `docs/reference/expressions/operators.md` | ⬜ Pending | |
| 41 | `docs/reference/expressions/fraction-api.md` | ⬜ Pending | |
| 42 | `docs/reference/expressions/module-api.md` | ⬜ Pending | |

### Phase 11: Reference - Properties
| # | File | Status | Issues Found |
|---|------|--------|--------------|
| 43 | `docs/reference/properties/frequency.md` | ⬜ Pending | |
| 44 | `docs/reference/properties/start-time.md` | ⬜ Pending | |
| 45 | `docs/reference/properties/duration.md` | ⬜ Pending | |
| 46 | `docs/reference/properties/tempo.md` | ⬜ Pending | |
| 47 | `docs/reference/properties/beats-per-measure.md` | ⬜ Pending | |

### Phase 12: Reference - Other
| # | File | Status | Issues Found |
|---|------|--------|--------------|
| 48 | `docs/reference/module-schema.md` | ⬜ Pending | |
| 49 | `docs/reference/glossary.md` | ⬜ Pending | |
| 50 | `docs/reference/index.md` | ⬜ Pending | |

### Phase 13: Developer - API
| # | File | Status | Issues Found |
|---|------|--------|--------------|
| 51 | `docs/developer/api/module.md` | ⬜ Pending | |
| 52 | `docs/developer/api/note.md` | ⬜ Pending | |
| 53 | `docs/developer/api/binary-expression.md` | ⬜ Pending | |
| 54 | `docs/developer/api/event-bus.md` | ⬜ Pending | |

### Phase 14: Developer - Core
| # | File | Status | Issues Found |
|---|------|--------|--------------|
| 55 | `docs/developer/core/expression-compiler.md` | ⬜ Pending | |
| 56 | `docs/developer/core/dependency-graph.md` | ⬜ Pending | |
| 57 | `docs/developer/core/binary-evaluator.md` | ⬜ Pending | |
| 58 | `docs/developer/core/symbolic-power.md` | ⬜ Pending | |

### Phase 15: Developer - Architecture
| # | File | Status | Issues Found |
|---|------|--------|--------------|
| 59 | `docs/developer/architecture/overview.md` | ⬜ Pending | |
| 60 | `docs/developer/architecture/data-flow.md` | ⬜ Pending | |
| 61 | `docs/developer/architecture/module-system.md` | ⬜ Pending | |
| 62 | `docs/developer/architecture/rendering.md` | ⬜ Pending | |

### Phase 16: Developer - Rendering
| # | File | Status | Issues Found |
|---|------|--------|--------------|
| 63 | `docs/developer/rendering/webgl2-renderer.md` | ⬜ Pending | |
| 64 | `docs/developer/rendering/camera-controller.md` | ⬜ Pending | |
| 65 | `docs/developer/rendering/picking.md` | ⬜ Pending | |

### Phase 17: Developer - Audio
| # | File | Status | Issues Found |
|---|------|--------|--------------|
| 66 | `docs/developer/audio/audio-engine.md` | ⬜ Pending | |
| 67 | `docs/developer/audio/instruments.md` | ⬜ Pending | |
| 68 | `docs/developer/audio/streaming.md` | ⬜ Pending | |

### Phase 18: Developer - WASM
| # | File | Status | Issues Found |
|---|------|--------|--------------|
| 69 | `docs/developer/wasm/overview.md` | ⬜ Pending | |
| 70 | `docs/developer/wasm/building.md` | ⬜ Pending | |
| 71 | `docs/developer/wasm/adapters.md` | ⬜ Pending | |

### Phase 19: Developer - Contributing
| # | File | Status | Issues Found |
|---|------|--------|--------------|
| 72 | `docs/developer/contributing/setup.md` | ⬜ Pending | |
| 73 | `docs/developer/contributing/code-style.md` | ⬜ Pending | |
| 74 | `docs/developer/contributing/pull-requests.md` | ⬜ Pending | |

### Phase 20: Index Files
| # | File | Status | Issues Found |
|---|------|--------|--------------|
| 75 | `docs/index.md` | ⬜ Pending | |
| 76 | `docs/user-guide/index.md` | ⬜ Pending | |
| 77 | `docs/tutorials/index.md` | ⬜ Pending | |
| 78 | `docs/developer/index.md` | ⬜ Pending | |

---

## Status Legend
- ⬜ Pending - Not yet reviewed
- 🔄 In Progress - Currently being reviewed
- ✅ Complete - Reviewed and fixed
- ⏭️ Skipped - No changes needed

---

## Common False Patterns Already Identified

### 1. Note Creation Errors
**Wrong:** "Double-click the workspace to create a note"
**Wrong:** "Click on empty space to add a note"
**Wrong:** "Right-click to create note"
**Correct:** Select a note → Variable Widget "Add Note / Silence" section → Choose type & position → Click "Create Note"

### 1b. Variable Widget UI Labels
**Wrong:** "Add Note" section, "Add at Start+Duration", "Add at Same Time"
**Correct:** "Add Note / Silence" section, "At End" (for sequences), "At Start" (for chords)

**Wrong:** Default frequency for "At Start" is `5/4` times selected note
**Correct:** Default frequency is always `[selected].f` (same as selected note) - user edits to create intervals

### 2. Legacy-Only Code Blocks
**Wrong:**
```javascript
module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))
```

**Correct:**
```
base.f * (3/2)
```

<details>
<summary>Legacy JavaScript syntax</summary>

```javascript
module.baseNote.getVariable('frequency').mul(new Fraction(3, 2))
```
</details>

### 3. Invalid Property References
**Wrong:** `[1].l`, `[1].len`, `[1].length` (for duration)
**Correct:** `[1].d`, `[1].dur`, `[1].duration`

**Wrong:** `[1].st`, `[1].time` (for startTime)
**Correct:** `[1].t`, `[1].s`, `[1].start`, `[1].startTime`

### 4. Dependency Color Descriptions
**Potentially outdated:** "Blue lines = depends on, Red lines = dependents"
**More accurate:** Colors are property-specific (Orange=frequency, Teal=startTime, Purple=duration)

### 5. Duration/Beat Expressions
**Wrong:** `60 / tempo(base)` as standalone (works but verbose)
**Better:** `beat(base)` (built-in helper that does the same thing)

### 6. Incomplete Legacy Code Examples
**Wrong:** `module.getNoteById(5)` (incomplete - doesn't get a property)
**Correct:** `module.getNoteById(5).getVariable('frequency')` (complete legacy reference)

### 7. Missing Dependency Line Thickness
**Missing info:** Dependency lines have thickness meaning
**Correct:** Thick lines = parent dependencies (what selected note depends on), Thin lines = child dependencies (what depends on selected note)

### 8. Liberate Dependencies Misunderstanding
**Wrong:** "Liberate Dependencies" converts references to raw computed values
**Correct:** "Liberate Dependencies" substitutes the liberated note's expressions into dependent notes (bypasses the note in the chain). Example: `[1].t + [1].d` becomes `base.t + beat(base)` if Note 1's expressions were `base.t` and `beat(base)`.

### 9. Module Drop Behavior
**Wrong:** "Dropping a module replaces the workspace"
**Correct:** Dropping a module integrates it into the workspace by remapping dependencies:
- Drop on note/BaseNote: All properties remapped relative to that note
- Drop on measure bar: Time remapped to measure, frequency to workspace's BaseNote
- Drop on silence: Not supported

### 10. Add Measure Availability
**Wrong:** "Add Measure" available on any note
**Correct:** "Add Measure" only appears on:
- BaseNote (shows "Add New Measure Chain")
- Last measure in a chain (shows "Add Measure")

### 11. Delete and Keep Dependencies
**Wrong:** Keeps dependencies with their original references
**Correct:** Same as Liberate + Delete - liberates the note first (substitutes expressions into dependents), then deletes it

### 12. Corruption Display (≈ Symbol and Hatching)
**Wrong:** Directly corrupted shows decimal, transitively corrupted shows fraction
**Correct:** Both show fractional approximation with ≈ prefix. Visual distinction is via hatching:
- Directly corrupted (irrational/TET): Crosshatch pattern (X) on note
- Transitively corrupted: Single diagonal hatch pattern on note

### 13. Variable Widget Positioning
**Wrong:** Right side, auto-sizing, edge-resizable
**Correct:** Bottom-left corner, header-draggable only (not edge-resizable), anchored to bottom

### 14. Undo/Redo History Scope
**What's tracked:** Note additions, deletions, property changes, module loads
**What's NOT tracked:** View changes (pan/zoom), playback state, Module Bar changes

### 15. Broken Links
Check for and remove links to non-existent pages like `/about/changelog`

### 16. "Real-time" Claims
**Wrong:** "Updates in real-time as you type"
**Correct:** Changes take effect on save, not while typing

---

## Workflow Per Section

1. **New chat**: Start fresh chat for the section
2. **Tell Claude**: "Review docs section [Phase X] per REVIEW-PLAN.md"
3. **Claude reviews**: Examines source code + docs, makes fixes
4. **You review**: Check the edits
5. **Mark complete**: Update status in this file from ⬜ to ✅
6. **Repeat**: New chat for next section
