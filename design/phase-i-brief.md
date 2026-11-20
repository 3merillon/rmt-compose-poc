# Brief: RMT Compose v2, Phase I — the instruments, overhauled

You are continuing work on RMT Compose, a music composition app (Vite, WebGL2, Web Audio, exact BigInt
fractions) in which every pitch, start and length is an exact relation to other notes. The owner is the only
contributor; he is a pianist and hears pure intervals apart from tempered ones, on sine waves too. Read your
memory index (MEMORY.md) first. These memory notes bind this work: v2-integration-branch,
no-claude-attribution-in-commits, planned-app-work, rust-core-is-the-engine, bigint-fraction-conventions,
renderer-perf-verification, dev-server-hmr-stale-boot, browser-test-module-loading, playwright-edge-channel,
docs-site-conventions, bash-heredoc-scripts-fail, commit-to-musical-judgment, flat-measure-is-not-inaudible,
listening-tests-one-sheet, rmt-composer-program.

Phase I comes before Phase D (the Rust core). The owner's order, 20 November 2026.

## What the owner asked (his words)

- "some instruments have terrible enveloppes (like piano and violin. look at them for shorter notes the
  immediately cut down linearly. I want to spend a Phase on improving the quality and enveloppes of all the
  instruments."
- "we might improve the instruments that have a continuous melody perhaps (assuming they are the same
  instrument playing it) and as you said sound could extend past the actual note definition giving us a real
  synthesis that resembles true play."
- "a full instrument overhaul and improvement", planned so that he can launch it in a fresh session.

So: every instrument, its envelope and its sound; sound that may continue past the note's end (a release
tail, as when a key is lifted or a bow leaves the string); and melodic lines played as lines by one player.

## Where and how to work

- **Code:** in `C:\GitHub Projects\rmt-compose-v2`, a git worktree on the local branch `v2`. Never touch
  `main` or the published folder `C:\GitHub Projects\rmt-compose-poc`, except its untracked
  `.claude/skills/rmt-composer/` and `paper/rewrite-notebook.md`. Never push anything.
- **Branches and commits:** one local branch per item (`git switch -c <name>` from `v2`; `git checkout`,
  `restore`, `reset` and `clean` are denied). Fast-forward `v2` when the item is done and tested
  (`git switch v2 && git merge --ff-only <branch>`). Commit messages carry no Claude or Anthropic attribution
  of any kind, overriding any default; check with `git log -1 --format=%B`.
- **Tests:** `npm test` in the v2 folder runs thirteen Node suites (the list is in `package.json` and in
  `docs/developer/contributing/pull-requests.md`) and must pass after every change. The audio code has no
  tests of its own yet: add them (see "Checks" below).
- **Dev server:** launch configuration `rmt-compose-v2`, port 3220 (`preview_start {name: "rmt-compose-v2"}`).
  Restart it after editing files before checking anything (hot reload leaves stale module state). `?perf=1`
  exposes `window.__rmtRenderer`, `window.__rmtPerf` (`getModuleRef()`, `emit`) and `window.__rmtWorkspace`.
- **Browser checks:** headless Playwright with `channel: 'msedge'` (bundled Chromium is not installed). Load a
  module with `page.addInitScript` writing `localStorage['rmt:moduleSnapshot:v1']` (guard it with a
  sessionStorage flag so a reload keeps the app's own save). Open the note widget on a note with
  `eventBus.emit('modals:requestRefresh', { note, measureId: null })` (import `/src/utils/event-bus.js` in the
  page). Temporary scripts go in `scripts/perf/__tmp-*.mjs` (gitignored). Web Audio renders offline in the
  page: `new OfflineAudioContext(2, sr * seconds, sr)` with the app's own instrument classes is the way to
  measure what an instrument plays (no speakers, no real time). Leave the test origin clean.
- **Renderer changes** (drawing a tail past a note's end will be one): follow renderer-perf-verification:
  pixel-diff (`scripts/perf/visual-regress.mjs`, `PW_CHANNEL=msedge`, tolerance 300) against a baseline from
  `v2` HEAD served on another port, and frame timings on par.
- **Docs:** `docs/` (VitePress) must describe what you change: `docs/developer/audio/` (audio-engine,
  audio-graph, instruments, reverb, streaming) and `docs/user-guide/playback/` (audio, instruments). After any
  `src/` edit run `python scripts/shift-doc-citations.py . v2 <the src files you changed>`, then
  `node scripts/check-doc-citations.mjs docs --only=<base names>` and read every line it prints. The shifter
  matches by base name, so a change to one `index.js` can shift citations of another: check those by hand.
  `npm run docs:build` must pass; dead links are fatal.
- **Scripts:** long Bash heredocs lose backslashes here; write Python or JS edit scripts to files in the
  scratchpad and run them.
- **The composer skill** (`.claude/skills/rmt-composer/`, in the published folder, untracked): its rule 8 is
  about timbre and purity; its `references/format.md` lists "the instruments as they really are". Update both
  the same day an instrument changes. `references/findings.md` records the owner's verdicts: write every one
  there with the date and his words.
- **Credits:** be sparing; delegate wide reading to cheaper models (an Explore agent); never run several large
  agents at once. Report after each step.

## State of v2 (20 November 2026)

Phases A, B (one syntax), C (exact irrationals, `~` approximations) and L (the library written natively) are
done. Since then, on `v2`: the canon retranslated with one bass for both voices and shipped whole in Custom
(65f1282, 594bfc9); group edits and selection by relation (ed1487b); a CSS colour parser fix (ba48439);
HEAD 8904525. The WASM evaluator is off (`WASM_MATCHES_VARIABLE_LAYOUT = false`); the browser runs the JS
evaluator. Settings → Appearance → "Show every envelope" draws each note's envelope inside it (off by default:
the owner chose to keep it off).

## What is there today (read these first)

- **Instruments** (`src/instruments/`): synths in `synth-instruments.js` (sine-wave, square-wave,
  sawtooth-wave, triangle-wave, organ, vibraphone, fm-epiano, harmonium, harmonium-soft); sampled piano and
  violin in `sample-instruments.js` on `multisample-instrument.js`, from VSCO-2 CE (CC0), manifests in
  `public/samples/{piano,violin}/manifest.json` (14 and 15 zones, about one per octave, so most notes are
  resampled several semitones; `velLayers` reserved and unread; no loop points read anywhere). An older
  single-sample `SampleInstrument` class is still in `instrument-manager.js`: find out whether anything uses it.
- **The envelope** (`src/instruments/instrument-manager.js`): `envelopeTimes()` and `applyVoiceEnvelope()`.
  Everything happens INSIDE the note: linear attack from silence, exponential decay to a sustain level, hold,
  exponential release that reaches silence exactly at the note's end. Instruments give ratios of the note's
  duration (sine: attack 0.1, decay 0.1, sustain 0.7, release 0.2), so a long note gets a slow attack and a
  long fade. Piano and violin give absolute seconds (piano attack 0.004 s, release 0.25 s; violin 0.03 s and
  0.18 s) that must fit inside the note: a note shorter than attack + release is scaled into one ramp. That is
  the "cut down linearly" the owner saw. Samples hold flat at full level, so a long piano note never dies away
  as a piano does. Floors (`ATTACK_FLOOR`, `RELEASE_FLOOR`) keep notes from clicking.
- **Per-note attack and release** (variables `attack`, `release`, interpretation variables like `amplitude`):
  shares of the note's own duration, inherited from the BaseNote when unset. The owner's decision; do not
  reopen it, but the design must say what a release share means once the release lies after the note's end.
- **Scheduling** (`src/player/audio-engine.js`, `_scheduleNote`): one voice per note, created up to 2 s ahead
  (`LOOKAHEAD`), stopped at `start + duration + 0.15 s` (`RELEASE_TAIL`). Live tempo maps score time to clock
  time (`src/player/time-map.js`, `setRate`); loop seams, pause fades and `stopAll` cancel or fade voices
  (`_cancelScheduledFrom`, `pauseFade`): a tail past the note's end must survive all of these correctly.
  `src/player/audio-graph.js`: one bus per instrument, reverb send/return, pitch-driven stereo pan, limiter.
- **Drawing** (`src/renderer/webgl2/renderer.js`, `_envelopeSharesFor`, shader `rectBorderFS`): the envelope is
  drawn inside the note rectangle from `envelopeShares()`, the same function the audio uses, so that what is
  seen is what is heard. Keep that principle when the sound outlives the note.
- **Purity is the point of the app.** Rule 8 of the skill: detune, chorus and vibrato above a few cents blur
  the cues by which the owner hears a pure chord from a tempered one. Today square and sawtooth play a 3-voice
  unison detuned ±4 cents; the harmonium voices were built for purity (16 partials, one oscillator, no detune,
  fixed attack and release in seconds; read their comment block). Pitch must stay exactly the written
  frequency: a sample's playback rate is frequency / root frequency.
- **Amplitude** scales the envelope peak (`noteData.amplitude`, `src/player/amplitude.js`); MIDI export
  (`src/midi/`) writes velocity from it and note-off at the note's end.

## The work

### 1. Measure first

Build an offline render harness (headless Edge, OfflineAudioContext, the app's own instrument classes and
`applyVoiceEnvelope`): every instrument at short (about 0.1 s), medium (0.6 s) and long (4 s) notes, low,
middle and high pitch; record the RMS envelope and the spectrum over time. Compare the envelope with what the
workspace draws. This is the evidence for the design and, later, the regression test.

### 2. Design document, then the owner's approval

Write `design/phase-i-instruments.md` in the v2 folder and present it before writing code, as Phase C did. It
must settle, with a recommendation for each and the decision left to the owner where it is his:

- **The note's end is a note-off, not the end of the sound.** Attack and decay start at the note's start; the
  release begins at the note's end and rings past it (a key lifted, a bow lifted). A note therefore occupies
  its written time plus its tail. What a per-note `release` share means then (a share of the note's duration,
  measured after its end, is the natural reading). What happens when a tail runs past the end of the module,
  across a loop seam, under a pause.
- **Each instrument's own envelope in seconds where the instrument is physical** (a hammer strikes in a few
  milliseconds whatever the note's length; a piano string decays on its own; an organ pipe holds), ratios only
  where a ratio is the character. Short notes keep their shape: a short piano note is a short strike and its
  damper, never one long ramp.
- **Lines played by one player.** When a note follows the previous one of the same instrument, the
  relational structure already says so: its start is `[p].t + [p].d` (see `src/utils/followed-note.js`). That
  is RMT-native: the relation is the phrase. Propose what a line changes per instrument: violin (no new bow
  attack, the next pitch taken without a gap: legato), organ and winds-like voices (legato, no re-attack),
  piano (each note struck, the previous one damped by its own release; a repeated pitch re-strikes the same
  string). Whether time adjacency alone (an end exactly equal to the next start, without the relation) also
  counts. A glide between pitches (portamento) passes through every impure pitch on the way: recommend it off,
  and ask.
- **Sound quality, per instrument.** Piano: natural decay from the samples, more zones if the size budget
  allows (the samples are about 600 KB per instrument today), release that sounds like a damper. Violin: a
  sustain that holds as long as the note (loops or longer samples), a bow attack, a release. Vibraphone and
  fm-epiano: decaying bell and tine tails past the note. The basic synths: what each is for. Sources must be
  openly licensed (CC0 or similar, credited in `public/samples/CREDITS.md`); ask before adding large files.
  `velLayers` and dynamics from `amplitude` if the samples allow it.
- **Purity.** Recommend removing the ±4-cent unison of square and sawtooth (or making it 0 by default), no
  vibrato or chorus by default, exact pitch everywhere; this changes how two instruments sound, so it is the
  owner's decision. Keep the harmonium voices as they are unless he asks.
- **Drawing the tail.** The workspace must be able to show what is heard, the tail past the note's end
  included. The owner (20 November): "this might show the note envelops extending past the note definition
  (which we could display or not, more granular controls in what we display here); and wouldn't adversly
  affect selection or anything like that." So:
  - the tail is display only. The note is still its written rectangle for everything else: picking and hover
    (`pickAt`, `pickAllAt`, `_isPointInsideRoundedNote`, `hitTestSubRegion`), the marquee (`pickRect`),
    drags and resizes, snapping to a note's end, dependency lines and labels, the module's end time and the
    playhead's tracking. Test that none of these changes with tails drawn;
  - finer display controls in Settings → Appearance, replacing or extending the one "Show every envelope"
    toggle: for example the envelope inside notes that set attack or release / inside every note / the tail
    past the note's end, each on or off. Propose the set, keep today's look as the default (envelopes off,
    as he chose), and let him design how it looks; he designs the interface pixel by pixel.
- **Cost.** More simultaneous voices (tails overlap the next notes): measure polyphony and CPU on the largest
  library modules and the perf stress modules; a voice limit and how it steals.

Make predictions the owner can check by ear ("the piano's short notes will sound struck and damped, not
faded"), never claim to have heard anything.

### 3. Implement, instrument by instrument, after approval

One branch per item (for example: envelope engine with tails; scheduling and transport with tails; lines and
legato; piano; violin; the other voices; drawing). After each, the measurements of step 1 again, and a
listening sheet for the owner: one module that plays each passage twice (as before, then as now) with a
numbered table (listening-tests-one-sheet). Where "as before" cannot be played by the new engine, render both
offline to WAV and put the pairs in one numbered folder with the table, rather than several look-alike tabs.
Record his verdicts in the skill's findings.

## Checks (add them to npm test)

- Envelope invariants for every instrument at many durations and amplitudes: starts and ends at silence, no
  NaN, peak equals the amplitude-scaled level, the release begins at the note's end, the voice is stopped
  after its tail and not before, the drawn shares equal the scheduled ramps.
- Line detection on the default module (the canon): its theme is one line of 25 notes, each bass one line.
- With tails drawn, picking, hover, marquee, drags, resizes and snapping give exactly the same results as
  without (in the browser, on the canon and a perf stress module); with tails off, the canvas is
  pixel-identical to `v2` HEAD before the phase.
- Transport with tails: loop seams, pause, stop, live tempo changes and undo during playback, in the browser.
- MIDI export unchanged unless a change is intended and listed.

## Decisions the owner made; do not reopen them

The notation (f, t, d per note; the BaseNote holds the only absolute values; `base.d` is the time unit); the
kinds (only a note with f, t and d sounds); amplitude, attack and release as interpretation variables
(attack and release shares of the note's own duration); time is external (a dropped module takes t and f from
the target and keeps `base.d`); the owner designs the interface (existing styles, check every change at 375 px
wide); WASM stays off until Phase D.

## Definition of done for every item

`npm test` passes with new tests for what changed; the change is checked in the browser after a server
restart (and by ear only by the owner); docs and citations updated and the docs build passes; the skill's
rule 8 and `format.md` updated when an instrument changes; committed on its branch with no attribution and
`v2` fast-forwarded; nothing pushed; a short report to the owner: what changed, what was verified and how,
what was not, and what you predict he will hear.

After Phase I comes Phase D, the Rust core; its brief is the "Phase D" section of
`C:\GitHub Projects\rmt-compose-poc\.claude\next-phases-prompt.md`, and the owner's goal for it is more notes,
with faster evaluation, selection and dependency walks. Ask before starting it.

Start by reading the memory notes above, then step 1.
