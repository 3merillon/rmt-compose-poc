# Phase I — the instruments, overhauled (design, for approval)

20 November 2026. Branch `phase-i-design` (from `v2` at 1050748). Nothing in `src/` changes until the owner has
answered the questions in §0. Every number here comes from `scripts/perf/measure-instruments.mjs` (new on this branch:
each instrument at 0.1, 0.6 and 4 s, at 65.75, 263 and 1052 Hz, rendered offline in headless Edge through the app's
own instrument classes and `applyVoiceEnvelope`, stopped where the engine stops it). Its output is
`scripts/perf/__visual__/instruments/` (gitignored: `summary.txt`, `measure.json`, one `.svg` per instrument showing the
heard envelope against the drawn one). The numbers are measurements; what they will sound like is a prediction until
the owner has heard it.

## 0. The decisions, with my recommendation

| # | Question | Recommendation |
|---|----------|----------------|
| D1 | Is a note's end a note-off (the release rings after it) rather than the end of the sound? | Yes, for every instrument, the harmonium voices included (their attack and release keep their milliseconds; only the release moves after the end). §2 |
| D2 | A per-note `release` share, once the release lies after the end | The release lasts `release × d`, counted from the note's end. `attack` is unchanged (`attack × d` from the start). §2.2 |
| D3 | Release shares above 1 (a tail longer than the note) | Allow up to 4, like amplitude. Today the clamp is [0, 1]. §2.2 |
| D4 | Tails at the module's end | They ring out. Reaching the end parks the playhead and stops scheduling but does not cut sound; Stop, Pause and a new Play still cut, as today. §2.3 |
| D5 | Envelopes in seconds where the instrument is physical | Yes: the values in §3. Ratios only where you write them yourself (the per-note shares). |
| D6 | Who plays a note (the player rule) | Line first: own instrument → line predecessor (`[p].t + [p].d`, rests allowed) → copied line → today's rule. §4 |
| D7 | Does time adjacency alone (no relation) make a line? | No. §4.3 |
| D8 | Group INSTRUMENT row | Two buttons, "Each note its own player" and "One player". §4.5 |
| D9 | Line playing per instrument | Violin slurred within a line; piano struck note by note; sustained synths join by overlap. §5 |
| D10 | Glide (portamento) between the notes of a line | Off, and no setting for it. §5 |
| D11 | Square and sawtooth unison (3 oscillators, ±4 cents) | Remove it: one oscillator. §7 |
| D12 | Correct the recorded pitch of each sample zone | Yes: measure each zone once and play the written frequency exactly. §6.1, §7 |
| D13 | New sample sources (download, and larger files) | Look at the University of Iowa MIS recordings (piano; non-vibrato violin); ask you before any download, then before committing more than ~2 MB. §6 |
| D14 | Drawing: curve shape and scale | Draw the curve that sounds (exponential, plus the sample's own decay), on a dB scale. §8 |
| D15 | Appearance settings | Two controls: "Envelope inside notes" (Notes that set attack or release / Every note / None) and "Tails after the note's end" (off by default). Today's look stays the default. §8 |
| D16 | Voice limit | 256 voices; above that, the quietest voice already past its note-off is faded out in 15 ms. §9 |
| D17 | The add-note section of the note widget | Your request: tint the whole section with the teal. Done on its own branch now (§10), for you to judge. |

You design the look and the wording on screen. Everything I propose for the interface is a placeholder in today's styles.

## 1. What the measurements show

### 1.1 The envelope today

Everything happens inside the written note (`envelopeTimes`, `applyVoiceEnvelope` in `src/instruments/instrument-manager.js`):
a linear attack, an exponential decay to a sustain level, a hold, then an exponential release that reaches silence
exactly at the note's end. The voice is stopped 0.15 s later, already silent. Measured: at every instrument, pitch and
length the level at the note's end is −49 to −200 dB re its peak and **nothing sounds after the end** (`ring > 60 dB` is
0 to 5 ms everywhere).

- **Short notes are one ramp.** Piano and violin give their attack and release in seconds (piano 4 ms and 250 ms,
  violin 30 ms and 180 ms). They must fit inside the note, so a 0.1 s note is scaled into 1 ms of attack and 89 ms of
  release: the whole note is a release. The heard level of a 0.1 s piano note is 0.29 of its peak a quarter of the way in,
  0.03 at half, 0.003 at three quarters. The workspace draws that release as a straight line (0.85, 0.56, 0.28): the
  "cut down linearly" you saw is the drawing; the sound fades exponentially over the same 90 ms.
- **Synth envelopes scale with the note.** Sine is attack 0.1·d, decay 0.1·d to 0.7, release 0.2·d, so a 4 s sine note
  swells for 0.4 s and fades for 0.8 s, and a 0.1 s one has 10 ms and 20 ms. The release is exponential to −80 dB, so the
  last 0.2–0.3 s of a 4 s synth note is already below −50 dB: long notes audibly end before their written end.
- **Samples are cut at 3.5 s.** `scripts/build-samples.mjs` caps every recording at 3.5 s with a fade from 3.4 s. A 4 s
  piano or violin note is silent for its last 0.5–0.6 s, before its release begins (measured: 0.51–0.60 s of silence).
- **The piano does die away, but the drawing does not say so.** The envelope holds the sample at full gain; the
  recording itself decays (C4 zone: −8 dB at 0.5 s, −15 dB at 1 s, −20 dB at 2 s, −26 dB at 3 s). Through a 4 s note the
  drawing shows full level at a quarter, half and three quarters; the heard level is 0.17, 0.10, 0.05 of the peak.
- **Drawn and scheduled curves differ.** The shader (`rectBorderFS` in `renderer.js`) draws decay and release as straight
  lines; the audio ramps are exponential. The largest difference between the drawn level and the scheduled gain, over a
  note, is 0.17 (vibraphone) to 0.61 (piano) of the peak, always in the release. The principle "what is seen is what is
  heard" holds for the times (attack, decay and release start and end where they are drawn) but not for the shapes.

### 1.2 Pitch

- Every synth plays the written frequency: the mean pitch over a held note is 0.00 cents off at all three pitches
  (sine, triangle, organ, vibraphone, harmonium, harmonium-soft; fm-epiano within 0.7 cents, its index decay is a
  frequency modulation by design).
- Square and sawtooth: three oscillators at −4, 0 and +4 cents. At 263 Hz neighbouring oscillators beat at 0.61 Hz and the
  outer two at 1.2 Hz (proportionally faster higher up), and the pitch track of a held note swings 19 to 144 cents peak to peak (that number is the tracker's reading of the beating, not a
  vibrato; the mean stays within 5 cents).
- **Piano zones are stretch-tuned.** Each recording, at playback rate 1, measured against the root the manifest gives it:
  C1 −24, G1 −18, C2 −16, G2 −10, C3 −6, G3 −7, C4 −2, G4 −4, C5 −2, G5 +1, C6 +6.5, G6 +2, C7 +12.5, G7 +3.5 cents
  (±3 cents: the fundamental of a low string is weak and the higher partials of a string are sharp). A 3/2 within one zone
  is exact (the playback rates are in exactly that ratio); a 3/2 across two zones carries their difference, e.g. 2 cents
  for C4→G4, 8.5 cents for C5→C6 an octave, and a C1 bass under a C4 note is 22 cents flat of the written ratio.
- **Violin zones carry vibrato and are off pitch.** The source is VSCO-2 CE "Arco Vib". Pitch swing through a held
  recording: 29 to 71 cents peak to peak in 14 of 15 zones (G3: 6 cents). Mean pitch against the root: −17 (C6) to
  +25 cents (G6). A violin note at 1052 Hz plays 19–24 cents flat of what is written.

### 1.3 Spectrum over time

- Piano: the brightness falls through a note (centroid 3.4 partials early at 66 Hz), as a struck string does. Real.
- fm-epiano: brightness falls from centroid 2.05 to 1.1 partials in the first 0.28 s (its index decay). Good.
- Vibraphone: one fixed PeriodicWave (partials 1, 4 and 10 strongest); the spectrum is identical at 30 ms and at 2 s.
  A struck bar's upper modes die much faster than its fundamental; here they do not.
- Organ, harmoniums, sine, triangle: steady by design.

### 1.4 What a voice costs, and how many sound at once

Offline render of 64 simultaneous 4 s notes (48 kHz, Edge): voices one core renders in real time — sine 2250,
triangle 2300, organ 2310, vibraphone 2220, harmonium 2340, piano 1720, violin 1720, square 700, sawtooth 710,
fm-epiano 630. Peak simultaneous voices if every note rang on after its end:

| module | notes | today (end + 0.15 s) | tail 0.5 s | 1.5 s | 3 s |
|---|---|---|---|---|---|
| the canon (default) | 153 | 7 | 12 | 24 | 39 |
| amazing-grace | 32 | 2 | 4 | 5 | 8 |
| chords-dense (perf) | 800 | 8 | 8 | 12 | 16 |
| voices-20000 (perf) | 20000 | 24 | 32 | 64 | 112 |
| hub-5000 (perf) | 5000 | 40 | 53 | 105 | 183 |

The worst case, 183 fm-epiano voices, is 29 % of one core. CPU is not the limit; node creation on the main thread
(the scheduler builds voices 2 s ahead in 100 ms batches) is unchanged per note.

## 2. The note's end is a note-off (D1–D4)

### 2.1 The envelope

A note's attack and decay start at its start; its sustain (or its natural decay) holds until its end; **the release
starts at the end** and rings after it, the way a key is lifted or a bow leaves the string. The note sounds for its
written time plus its tail. The release starts from the level the note has reached at its end (computed: a decay or a
natural decay is a known exponential), so a short note keeps its shape: a 0.1 s piano note is a 0.1 s strike followed by
its damper, never one long ramp.

- `envelopeTimes(env, duration, shape)` returns, in seconds: `attack`, `decay`, `sustain` (level), `release` (after the
  end), and `levelAtEnd`. `envelopeShares()` returns the same as shares of the duration, `release` possibly above 1. The
  renderer and the audio keep using the same function.
- The attack must still fit inside the note: a note shorter than its instrument's attack is attacked over its whole
  length (and scaled with the anti-click floor as today). Nothing else needs to fit.
- The voice is stopped when the release has reached silence (`end + release + 20 ms`), no longer at `end + 0.15 s`.

### 2.2 Per-note attack and release (D2, D3)

Your decision stands: they are shares of the note's own duration. The reading that follows from the note-off: `attack`
is `attack × d` from the start, as now; `release` is `release × d` **counted from the end**. A note with `release 1/2`
rings on for half its own length after it. Today the release share is the last part of the note, so a module that sets
one will sound longer than before: no library module sets `attack` or `release` (checked), so only your own modules can
be affected, and I list the change in the release notes of the branch. The clamp is [0, 1] today; a tail longer than the
note is meaningful now, so I recommend [0, 4] for `release` (the bound amplitude has), [0, 1] kept for `attack`.

### 2.3 Transport (D4)

| situation | behaviour |
|---|---|
| loop seam | Unchanged: voices of the pass in flight keep their release across the seam (they already do for reverb); the next pass starts on time. A tail can overlap the next pass's first notes, as it would in a played repeat. |
| loop switched off mid-pass | Unchanged: notes after the final seam are cancelled; tails of the last pass ring out. |
| reaching the module's end | Changed: `stop(false)` today calls `audioEngine.stopAll()` (10 ms fade) the frame the playhead reaches the end, which would cut every tail. Proposed: stop scheduling and park the playhead, let tails ring out. |
| Stop button, Pause, a new Play, loading a module | Unchanged: they cut everything (Stop and a new Play with the 10 ms declick, Pause with its fade). |
| live tempo | Voices begun before the change keep their timing, tails included. Instrument releases are in clock seconds (a damper does not slow down with the tempo); a per-note `release` share is a share of the note's clock length through the time map, as its attack is today. |
| undo during playback | Unchanged; a voice already sounding finishes with its tail. |
| the module's end time, loop period, playhead, MIDI export | Unchanged: tails are interpretation, not notation. MIDI note-off stays at the note's end (it is a note-off: the receiving synth renders its own release). |

## 3. Each instrument's envelope (D5)

Seconds, where the instrument is physical. Proposed values (to tune by ear in the listening sheets):

| instrument | attack | body | release after the end |
|---|---|---|---|
| piano | 2 ms (keeps the hammer's transient) | the recording's own decay; no envelope decay | damper: 0.30 s at C1 falling to 0.10 s at C6; above F♯6 no damper (a piano's top strings have none): the note rings its natural decay |
| violin | the recording's bow onset, 5 ms anti-click | held for any length (loops, §6.2) | 0.12 s (bow lifted) plus the string's ring in the recording |
| organ | 30 ms | holds | 60 ms |
| harmonium, harmonium-soft | unchanged: 30 / 60 ms | holds | unchanged: 80 / 120 ms, now after the end |
| vibraphone | 2 ms | natural decay, T60 from 6 s (low) to 2 s (high); partials 4 and 10 decay 3× and 6× faster | 0.4 s (soft damper) |
| fm-epiano | 2 ms | natural decay, T60 from 5 s (low) to 1.5 s (high); index decay as today | 0.25 s |
| sine-wave | 15 ms | holds | 100 ms |
| triangle-wave | 15 ms | holds | 120 ms |
| square-wave, sawtooth-wave | 8 ms | decay 0.25 s to 0.7 | 100 ms |

A sine is the reference tone of the app; today a long sine swells and fades for 30 % of its length. Holding it level is a
change of character, which is why it is in the listening sheet as its own line.

## 4. An instrument is a player (D6–D8)

### 4.1 What the rule does today

`Module.findInstrument` (`src/module.js`): a note without an instrument takes the instrument of the note its frequency
reads (`[N].f`), else the BaseNote's (`base.f`), else the default. In the canon every theme note reads `base.f`, so the
theme inherits from the BaseNote, and setting the instrument of its first note changes that note alone.

### 4.2 The proposed rule

A **player** is a line: notes joined by the relation "starts where the previous one ends". A note's instrument:

1. its own `instrument`, if it sets one: it starts a new player, and the line goes on from it with that instrument;
2. else, if its start is written from the end of a sounding note p (`[p].t + [p].d`, or that plus a rest,
   `[p].t + [p].d + base.d * k`): p's player and instrument;
3. else, if it is a copy of a note k of a line (start `[k].t + X`, frequency `r * [k].f`) and the copy of k's predecessor
   exists (written from it with the same `X`): that copy's player. A copy of a line is a line: a canon voice, a voice in
   parallel;
4. else it starts a player, and takes its instrument as today: the frequency parent's, then the BaseNote's, then the default.

Rests are in because a phrase with a breath is one player: the canon's theme has two rests and its first bass two.
Copies are in because of how you wrote the canon: the second bass is the first one, note by note, four time units later
and a fifth higher (`[k].t + base.d * 4`, `(3/2) * [k].f`), so editing the first bass changes both.

### 4.3 What it does, measured on every library module

- **The canon** (default module, 153 sounding notes): exactly three players. The theme, 25 notes from note 9
  (22 follows, 2 rests); the first bass, 70 notes from note 10 (67 follows, 2 rests); the second bass, 58 notes from
  note 24 (57 copies). Setting note 9's instrument changes the whole theme; note 10's, the first bass; note 24's, the
  second. Without rule 3 the second bass would be 58 one-note players; without rests the theme would be three players.
- One correction to the brief: with no instrument set anywhere, the second bass's first note (24) reads `[10].f`, so by
  rule 4 it takes the first bass's instrument. Two players, one instrument, until you set note 24.
- Melodies: one player each (amazing-grace 32, bach-minuet 16, frere-jacques 32, greensleeves 19 through its rest,
  ode-to-joy 15, scarborough-fair 15, twinkle 14). Scale systems BP-13, Mixed-Base, TET-12/19/31: one player each.
  Chords, progressions, intervals, tesla and the perf modules: one player per note (nothing in them is written from
  another note's end).
- **No note in the library changes instrument** (97 modules, 100,606 sounding notes). Only five modules set an
  instrument at all (the scale systems, on their BaseNote), and every line resolves to the same instrument as today.
- Time adjacency without the relation (D7): 99,016 notes start exactly where another note ends without saying so,
  nearly all in the perf modules and in progressions, where several notes end at that instant and nothing says which
  one is the predecessor. The relation is the phrase; adjacency alone should not make one.

### 4.4 Old modules

Modules you made yourself may contain a note that follows another (`[p].t + [p].d`) but reads its frequency from a note
of a different instrument. Proposed: on load, compute both rules; where they differ, write the instrument the note had
onto it, so it keeps sounding as it did (it then starts its own player), and log how many. In the library that number is 0.

### 4.5 The note widget and the group widget (D8)

- Note widget, INSTRUMENT row: today the select shows the resolved instrument. Proposed wording beside it:
  "inherited — plays with note 9" (the player's first note, clickable to select it) or "own player". You design the look.
- Group widget, INSTRUMENT row (`group-widget.js`; `setGroupProperty` in `src/utils/group-edit.js`): today Apply sets the
  instrument on every selected note, which under this rule makes each note its own player. Proposed: two buttons in
  place of Apply,
  - **Each note its own player**: today's behaviour, named for what it does;
  - **One player**: set the instrument on the notes that start the selection's lines (rule 2–3 heads within the
    selection) and remove it from the other selected notes, so they inherit. On the canon's theme that is one edit, on
    note 9. A selection holding several lines (a chord progression) gets one instrument and as many players as it has
    lines; the widget says so ("3 players").
  - "Inherit" (the select's first entry) stays: it removes the instrument from every selected note.

## 5. Lines played as lines (D9, D10)

What the next note of the same player changes:

| instrument | within a line |
|---|---|
| violin | Slurred: no new bow attack. The next pitch enters by a 40 ms equal-power crossfade from the previous note into the sustained part of the next recording, with no gap and no glide. A rest ends the bow; the note after it is bowed anew. A repeated pitch is re-bowed (a new stroke, softer than a first attack). |
| piano | Each note struck. The previous note is damped by its own release at its end. A repeated pitch re-strikes the same string: a voice of the same instrument and exactly the same frequency still ringing is damped in 20 ms when the new strike begins (whatever the player: a piano has one string per pitch). |
| organ, harmoniums, sine, triangle, square, sawtooth | Joined by overlap: the previous note's release (60–120 ms) runs under the next note's attack. No change to the next attack. |
| vibraphone, fm-epiano | Each note struck; tails ring under the following notes, as a vibraphone does with its pedal down. |

Glide: a portamento passes through every pitch between the two written ones, impure ones included. I recommend no glide
and no setting for it; if you want one later it would be an interpretation variable, off by default.

## 6. Sound quality (D13)

### 6.1 Piano

The upright from VSCO-2 CE is sampled at C and G of each octave (14 zones), so most notes are resampled by up to ±3.5
semitones, and each recording stops at 3.5 s. Proposed:

1. per-zone tuning: store each zone's measured pitch in the manifest (`tuneCents`) and play `f / (rootHz · 2^(tuneCents/1200))`,
   so every note plays the written frequency (D12);
2. longer recordings: no 3.5 s cap; keep each recording until it decays to −60 dB (low strings ring 15–20 s) and let the
   voice end with the recording;
3. a damper release (§3) and no damper above F♯6;
4. more zones and two dynamics if a better source allows. The University of Iowa MIS piano recordings (a Steinway,
   every semitone, pp / mf / ff, long natural decays; their terms, as I remember them, allow use without restriction —
   to verify on their site) would give zones every minor third and `velLayers` read from `amplitude`. I have not
   downloaded anything; the build script fetches from the source, and I will ask you first.

Size: AAC at 96 kb/s mono is 12 KB per second. Today's piano is 600 KB. 28 zones × 2 dynamics × about 8 s average is
about 5.4 MB, loaded lazily per zone as today (a module only fetches the zones its notes need). I would ask before
committing anything above about 2 MB.

### 6.2 Violin

The "Arco Vib" recordings swing 29–71 cents and are off pitch by up to 25 cents (§1.2), and stop at 3.5 s. Proposed:
non-vibrato sustained recordings (Iowa MIS has arco non-vibrato violin at every semitone and three dynamics, by memory;
VSCO-2 CE may have a non-vibrato set, unchecked), per-zone tuning as for the piano, and **loop points** found at build time
(a stretch of steady sustain, joined where the waveform matches, written as `loopStart`/`loopEnd` in the manifest and played
with the buffer source's loop), so a held note lasts as long as it is written. A non-vibrato tone loops cleanly; a
vibrato tone would wobble at the seam. The bow attack is the recording's own; the release is the bow lifted (§3).

### 6.3 Vibraphone and fm-epiano

Vibraphone: three oscillators (partial 1, partial 4, partial 10 with the small ones) each with its own exponential decay,
so the bar's upper modes die first, as a struck bar's do; natural decay through the note; a soft damper after it.
fm-epiano: its existing index decay plus a natural amplitude decay; the release is the tine's damper.

### 6.4 What the basic synths are for

| voice | for |
|---|---|
| sine-wave | the reference: pitch alone, nothing to beat. The default. |
| triangle-wave | a soft voice with odd partials only (3, 5, 7 quietly): a flute-like line. |
| square-wave | odd partials, louder: clarinet-like; a 7/4 meets on partial 7, a 5/4 on 5. |
| sawtooth-wave | every partial: bright; the harmonium is the same idea built for listening to tuning. |
| organ | partials 1, 3, 4, 5, 6, 8, 9: no 2nd, no 7th, so a 7/4 has nothing to meet on it. |

## 7. Purity (D11, D12)

- Square and sawtooth: remove the ±4-cent unison (one oscillator). The unison makes every held note beat by itself,
  which is exactly the cue that tells a pure chord from a tempered one. This changes how both sound (thinner, steadier);
  it is your decision.
- No vibrato or chorus anywhere by default. The violin's vibrato is in its recordings, so removing it needs other
  recordings (§6.2).
- Exact pitch everywhere: synths already; samples after per-zone tuning. What stays, because it is the instrument: a
  piano string's partials are slightly sharp of the harmonic series (inharmonicity), and its two or three strings per
  note beat slightly against each other. A pure fifth on the piano will therefore still beat faintly at its coinciding
  partials; on the harmonium it will not. I say so in rule 8 of the skill.
- The harmonium voices stay as they are (only the note-off moves their release after the end).

## 8. Drawing what sounds (D14, D15)

- The envelope band is computed from `envelopeShares()` as now, but drawn with the curve that sounds: exponential decay
  and release, and for sampled instruments the recording's measured decay (a T60 per zone, stored by the build step in
  the manifest and used by both the audio and the drawing). I recommend drawing the band's height on a dB scale (full
  height 0 dB, nothing at −48 dB), because that is closer to how loudness is heard; on a linear scale a piano note looks
  dead after half a second while it is plainly audible.
- **The tail**: past the note's end, the band continues to `end + release`, drawn without a border and without the note's
  fill, in the note's colour at reduced alpha. Display only: picking and hover (`pickAt`, `pickAllAt`,
  `_isPointInsideRoundedNote`, `hitTestSubRegion`), the marquee (`pickRect`), drags, resizes, snapping to a note's end,
  dependency lines and labels, the module's end time and the playhead's tracking all keep using the written rectangle.
  The only change outside the drawing: the visible-range cull extends a note by its tail so a tail whose note is
  off-screen to the left still draws.
- Settings → Appearance, replacing "Show every envelope":
  - **Envelope inside notes**: Notes that set attack or release (default, today's behaviour) / Every note / None;
  - **Tails after the note's end**: off by default.
  With both at their defaults the canvas is pixel-identical to `v2` today (checked with `visual-regress.mjs` against a
  baseline served from `v2` HEAD, tolerance 300 px).

## 9. Cost (D16)

§1.4: with tails up to 3 s the peak is 39 voices on the canon and 183 on the heaviest stress module, at most 29 % of a
core. A limit protects slower machines and pathological modules: 256 voices; when a new voice would exceed it, the
quietest voice already past its note-off is faded out over 15 ms. A voice before its note-off is never stolen. The
engine counts voices and stolen voices (`?perf=1`), and the transport checks run on the canon and `hub-5000`.

## 10. The add-note section (D17, your request of 20 November)

"it's really hard to tell we are there as the background colo is the same as the rest of the note variable editing. we
should give the whole background the teal (or custom color) hue". The section (`createAddNoteSection` in
`src/modals/note-creation.js`) has a 2 px teal top border and a teal title, both hard-coded `#00ffcc`; the theme has no
token for it. On branch `add-note-tint`: the whole section gets a teal wash (the same `#00ffcc` at low alpha), so the
rows inside it read as part of it when the title has scrolled away. If you want it themable ("custom color"), the next
step is a theme token (`--rmt-add-note`) with `#00ffcc` as its default in every preset.

## 11. Order of work, after approval

One branch each, from `v2`, fast-forwarded when done and tested; a listening sheet after each audible item.

1. `envelope-noteoff`: the envelope engine (§2.1–2.2, §3 synth values); `scripts/test-envelopes.mjs` in `npm test`.
2. `transport-tails`: stop times, module end, voice limit (§2.3, §9); browser checks of seams, pause, stop, tempo, undo.
3. `players`: the rule (§4), its migration, widget wording and the group buttons; `scripts/test-players.mjs`.
4. `line-playing`: §5.
5. `synth-voices`: vibraphone, fm-epiano, unison removal (§6.3, §7).
6. `piano`: tuning, longer recordings, damper; new source if you agree (§6.1).
7. `violin`: non-vibrato source, loops, slurs (§6.2).
8. `draw-tails`: §8, with the pixel and timing checks of `renderer-perf-verification`.

Tests added to `npm test`: envelope invariants for every instrument at many durations and amplitudes (starts and ends at
silence, no NaN, peak equals the amplitude-scaled level, release begins at the note's end, voice stopped after its tail
and not before, drawn shares equal the scheduled ramps; run in Node on a recording AudioParam, no browser); players on the
canon (theme 25, bass 70, bass 58) and on every library module (no instrument changes); MIDI export byte-identical.
In the browser: picking, hover, marquee, drags, resizes and snapping identical with tails drawn; transport with tails.

## 12. Predictions, for you to confirm or refute by ear

- Short piano notes will sound struck and then damped, not faded; a run of 0.1 s piano notes will sound articulated.
- A held piano chord will keep dying away for as long as it is written, instead of stopping at 3.5 s.
- Notes of one zone already form exact intervals today; after per-zone tuning, a C1 bass under a C4 melody note will
  sound 22 cents higher than today, back on the written ratio.
- The violin with non-vibrato recordings will make a pure fifth on two violins stand still; today it shimmers.
- Square and sawtooth without the unison will sound thinner and dead steady; held pure chords on them will stop beating.
- A sine melody with the note-off model will sound joined (each release under the next attack) and its long notes will
  hold level to the end.
