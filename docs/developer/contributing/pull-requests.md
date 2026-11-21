# Preparing a pull request

Start from the target revision and keep the change reviewable. Describe the musical or user-visible result and which behavior you used as your baseline. Include steps a reviewer can repeat with the same score. If a note ID matters, say whether it belongs to the startup file, a library file or a reindexed export.

Run `npm test` and `npm run build`. For a library change compare the affected notes’ exact onset, duration and pitch, then play the result. For a change to the generated canon parts run `node scripts/gen-canon-parts.mjs --check`. Include the browser and input method for a gesture change.

Use the [performance harness](/developer/performance) when changing a hot path. Report the fixture, viewport, browser, timing boundary and whether you measured score evaluation, drawing or audio output. For a renderer change, compare equivalent scenes before and after and check redraw convergence.

For documentation changes, build VitePress, inspect the built pages and check the instructions in a fresh app session. [Build and deployment](/developer/contributing/build-and-deploy) includes the preview commands and screenshot tooling.
