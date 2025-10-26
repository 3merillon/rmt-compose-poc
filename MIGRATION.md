# Migration Guide: Legacy JS to ES Modules

This document records the incremental migration of the RMT Compose POC from script-tag globals to an ES module architecture powered by Vite, while preserving behavior at every step.

Key outcomes:
- Single entry via [src/main.js](src/main.js:1) and a clean [index.html](index.html:1).
- Source code lives in [src/](src/main.js:1), static assets and JSON in [public/](public/modules/index.json:1).
- Cross-module interactions standardized through [eventBus](src/utils/event-bus.js:1); transitional globals isolated behind [registerGlobals](src/utils/compat.js:1).
- Audio responsibilities centralized in [AudioEngine](src/player/audio-engine.js:1).
- Legacy root duplicates removed to avoid drift.

1. Directory layout

Runtime source of truth:
- Code: [src/](src/main.js:1)
- Assets: [public/](public/styles.css:1)

Notable entry points:
- App bootstrap: [src/main.js](src/main.js:1)
- Player orchestration: [src/player.js](src/player.js:1)
- Audio engine: [src/player/audio-engine.js](src/player/audio-engine.js:1)
- Modals: [src/modals/index.js](src/modals/index.js:1)
- Menu: [src/menu/menu-bar.js](src/menu/menu-bar.js:1)
- Compatibility facade: [src/utils/compat.js](src/utils/compat.js:1)
- Event bus: [src/utils/event-bus.js](src/utils/event-bus.js:1)

Static data:
- Modules JSON: [public/modules/](public/modules/index.json:1)
- Sample audio: [public/instruments/samples/](public/instruments/samples/piano.wav:1)
- Images: [public/images/](public/images/quarter.png:1)
- Styles: [public/styles.css](public/styles.css:1) (linked as /styles.css in [index.html](index.html:1))

2. Build and run

- Dev: npm run dev -> Vite at http://localhost:3000
- Build: npm run build -> dist/
- Preview: npm run preview

3. Bootstrap order

- [index.html](index.html:1) includes a single module script pointing to [src/main.js](src/main.js:1).
- [src/main.js](src/main.js:1) imports the player at top-level to guarantee DOM listeners are registered before DOMContentLoaded.
- Global shims (Fraction, tapspace, core classes, modals API) are registered via [registerGlobals](src/utils/compat.js:1) for legacy surfaces that still expect window access.

4. Compatibility facade

The facade in [src/utils/compat.js](src/utils/compat.js:1) centralizes any temporary window exposure while we continue to modularize.

Principles:
- Only expose minimal shared instances that are hard to thread through immediately.
- Log deprecation warnings via warnDeprecated() to flush lingering window.* usage during development.
- Favor direct imports or event bus messages over reading/writing window.

Current transitional globals
- audioEngine instance (via [src/player/audio-engine.js](src/player/audio-engine.js:1))
- module graph accessor (window.myModule) until full UI refactor lands

5. Event bus conventions

The lightweight bus in [src/utils/event-bus.js](src/utils/event-bus.js:1) decouples features without reintroducing globals.

Events currently in use:
- player:requestPause — issued by modals/UI before destructive actions
- player:octaveChange — octave adjustment requests from controls
- player:importModuleAtTarget — drop a module JSON onto a note target
- modals:show — open the note variables widget
- modals:requestRefresh — re-render variables panel for a note

6. Audio architecture

- All scheduling and playback is centralized in [AudioEngine](src/player/audio-engine.js:1).
- [src/player.js](src/player.js:1) delegates play, pause fade, and stop-all to the engine.
- Instrument creation and routing are owned by the engine, backed by [src/instruments/*](src/instruments/instrument-manager.js:1).
- Pause/resume timing relies on playheadTime and totalPausedTime; removed stale pausedAtTime references.

7. UI behavior fixes retained

- Note-length resizing regression fixed by broadening hit-test on the resize handle and eliminating an undeclared resizeOriginalScale write.
- Prevented base drag handlers from swallowing resize drags.
- Measure bars, playhead, and selection visuals unchanged.

8. Removed legacy duplicates

The following root-level items were removed once their ES6/public counterparts were in place, to avoid drift:
- Files: menu-bar.js, modals.js, module.js, note.js, player.js, fraction.min.js, moduleSetup.json, styles.css
- Dirs: instruments/, modules/, images/

9. Asset path policy

- Code should not reference root-level assets. Use /images/..., /modules/... and /instruments/samples/... which resolve to [public](public/styles.css:1) at dev and build time.
- A safety search confirmed there are no hard-coded references to removed root assets in *.js.

10. Testing checklist

- Launch dev server: npm run dev
- Create, drag, and resize notes; verify snapping and ghost overlays
- Import module via menu; verify dependencies and durations
- Play, pause, stop; check volume control and no console errors
- Open variables widget; edit values; verify refresh events
- Check measure bars and playhead tracking toggle

11. Rollback strategy

- Root duplicates were removed only after verifying no live references.
- If a regression appears:
  - Restore the affected asset from git history.
  - Prefer updating the reference to point at [public](public/styles.css:1) or [src](src/main.js:1) rather than restoring an obsolete root file.

12. Next steps

- Gradually retire the remaining facade globals by threading explicit imports (e.g., replace window.myModule with a module store).
- Add unit tests for scheduling offsets, pause/resume, and resize snapping.
- Consider TypeScript adoption for stronger contracts across modules.

Appendix A: Module responsibilities map

- [src/main.js](src/main.js:1): boot, wiring, global facade registration
- [src/player.js](src/player.js:1): UI interactions, delegates audio to engine
- [src/player/audio-engine.js](src/player/audio-engine.js:1): WebAudio graph, transport, scheduling
- [src/modals/index.js](src/modals/index.js:1): note variables widget
- [src/menu/menu-bar.js](src/menu/menu-bar.js:1): module icons and drag/drop
- [src/stack-click.js](src/stack-click.js:1): helper to forward note selection
- [src/instruments/instrument-manager.js](src/instruments/instrument-manager.js:1): instrument registry
- [src/utils/event-bus.js](src/utils/event-bus.js:1): decoupled pub/sub
- [src/utils/compat.js](src/utils/compat.js:1): transitional globals

End.