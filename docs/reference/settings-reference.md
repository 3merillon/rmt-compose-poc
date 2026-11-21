# Settings reference

Use this table to look up a control’s default or its saved value. Open the gear in the top bar to change a preference. [Settings walkthrough](/user-guide/interface/settings)

## Every setting, in one table

| Path | Type | Default | Range / values | Control |
|---|---|---|---|---|
| `appearance.themeId` | string | `'classic-orange'` | `classic-orange`, `slate-cyan`, `mono-light`, `high-contrast` | Theme dropdown |
| `appearance.overrides` | object | `{}` | sparse map of [token](#theme-tokens) → hex | The 15 color pickers |
| `appearance.note.heightWU` | number | `22` | 8 – 60, step 1 | Note height |
| `appearance.note.borderPxAtZoom1` | number | `1` | 0 – 6, step 0.5 | Border thickness |
| `appearance.note.roundedCornerPxAtZoom1` | number | `6` | 0 – 20, step 1 | Corner radius |
| `appearance.envelopes` | string | `'own'` | `own`, `all`, `none` | Envelope inside notes (an older boolean `showEnvelopes: true` reads as `all`) |
| `appearance.detailCutoff` | integer | `1536` | 1–500,000 | Reduce detail above |
| `appearance.neverReduceDetail` | boolean | `false` | — | Never reduce detail by note count |
| `appearance.showTails` | boolean | `false` | — | Tails after the note's end |
| `arrows.enabled` | boolean | `true` | — | Show note arrows |
| `arrows.mode` | string | `'reciprocal'` | `reciprocal`, `independent` | Arrow mode |
| `arrows.up` | `{n, d, label}` | `{n: 2, d: 1, label: null}` | positive integers, `1/16 ≤ n/d ≤ 16`, excluding unison | Up interval + quick-pick chips |
| `arrows.down` | `{n, d, label}` | `{n: 1, d: 2, label: null}` | same, derived from `up` in reciprocal mode | Down interval — shown in independent mode only |
| `audio.masterVolume` | number | `1` | 0 – 1, step 0.01 | Master volume (and the transport slider) |
| `audio.defaultInstrument` | string | `'sine-wave'` | the eleven [instrument names](#instrument-names) | Default instrument |
| `audio.maxVoices` | number | `256` | `128`, `256`, `512`, `1024`, `2048`, `4096` | Most voices at once |
| `audio.loop.fold` | boolean | `true` | — | Keep within an octave |
| `audio.tempered.enabled` | boolean | **`false`** | — | Play tempered (12-TET) |
| `audio.reverb.enabled` | boolean | **`true`** | — | Enable reverb |
| `audio.reverb.roomSize` | number | `0.5` | 0 – 1, step 0.01 | Room size |
| `audio.reverb.decaySec` | number | `1.8` | 0.1 – 12, step 0.1 | Decay |
| `audio.reverb.damping` | number | `0.5` | 0 – 1, step 0.01 | Damping |
| `audio.reverb.preDelayMs` | number | `20` | 0 – 200, step 1 | Pre-delay |
| `audio.reverb.wet` | number | `0.25` | 0 – 1, step 0.01 | Reverb amount |
| `audio.stereo.enabled` | boolean | **`false`** | — | Spread notes by pitch |
| `audio.stereo.width` | number | `0.6` | 0 – 1, step 0.01 | Amount |
| `audio.limiter.enabled` | boolean | **`true`** | — | Limiter |
| `audio.tempoRange` | `{min, max}` | `{min: 20, max: 300}` | whole BPM, 1 – 1000, `min < max` (an inverted pair resets to the default) | Tempo range |
| `library.iconSizePx` | number | `56` | 32 – 96, step 4 | Icon size |
| `library.showCents` | boolean | `true` | — | Show cents |
| `library.layoutVersion` | number | `2` | any number | Reserved layout version |
| `scale.x` | number | `1` | clamped into `scale.limits.xMin … xMax` | Horizontal (time) |
| `scale.y` | number | `1` | clamped into `scale.limits.yMin … yMax` | Vertical (pitch) |
| `scale.limits.xMin` | number | `0.3` | 0.001 – 1000 | Horizontal range |
| `scale.limits.xMax` | number | `2` | 0.001 – 1000 | Horizontal range |
| `scale.limits.yMin` | number | `0.3` | 0.001 – 1000 | Vertical range |
| `scale.limits.yMax` | number | `5` | 0.001 – 1000 | Vertical range |

## Theme tokens

These are the fifteen colours exposed by the Appearance tab.

| Group | Picker label | Token | Classic Orange | Slate Cyan | Mono Light | High Contrast |
|---|---|---|---|---|---|---|
| Interface | Accent | `accent` | `#ffa800` | `#38bdf8` | `#d17400` | `#ffd400` |
| Interface | Background | `bg` | `#151525` | `#0b1120` | `#f5f5f0` | `#000000` |
| Interface | Panel surface | `surface` | `#151525` | `#111a2e` | `#ffffff` | `#0a0a0a` |
| Interface | Panel border | `surfaceBorder` | `#3a3a4a` | `#26334d` | `#cfcfc7` | `#ffffff` |
| Interface | Text | `textPrimary` | `#ffffff` | `#e6f0ff` | `#1a1a1a` | `#ffffff` |
| Interface | Muted text | `textSecondary` | `#aaaaaa` | `#8fa3c0` | `#666660` | `#dddddd` |
| Interface | Active / delete | `danger` | `#ff0000` | `#f43f5e` | `#c62828` | `#ff2d2d` |
| Workspace | Note border | `noteBorder` | `#636363` | `#5a6a85` | `#9a9a92` | `#ffffff` |
| Workspace | Playhead | `playhead` | `#ffa800` | `#38bdf8` | `#d17400` | `#ffd400` |
| Workspace | Measure bars | `measureBar` | `#ffffff` | `#cbd5e1` | `#333333` | `#ffffff` |
| Workspace | Selection ring | `selectionRing` | `#ffffff` | `#38bdf8` | `#d17400` | `#ffd400` |
| Workspace | Hover ring | `hoverRing` | `#ffffff` | `#cbd5e1` | `#333333` | `#ffffff` |
| Dependency highlights | Frequency | `depFrequency` | `#ff8000` | `#fb923c` | `#e06600` | `#ff8000` |
| Dependency highlights | Start time | `depStartTime` | `#00ffff` | `#22d3ee` | `#0088aa` | `#00ffff` |
| Dependency highlights | Duration | `depDuration` | `#9d00ff` | `#a78bfa` | `#7a2fd0` | `#c46bff` |

The theme chooser applies a preset’s geometry and clears colour overrides. **Reset colors to theme** clears just the overrides. [Themes and appearance](/user-guide/interface/themes) · [Theme implementation](/developer/theming)

## Instrument names

`sine-wave`, `square-wave`, `sawtooth-wave`, `triangle-wave`, `organ`, `vibraphone`, `fm-epiano`, `harmonium`, `harmonium-soft`, `piano`, `violin`.

The default instrument sounds when a note, its player and the BaseNote all leave the instrument open. [Instruments and players](/user-guide/playback/instruments#players)

## The stored envelope

The settings store writes schema version 1 under `rmt:settings:v1` in localStorage for the browser origin. It validates fields on load and on write. A missing field takes its default, scale values clamp to the validated limits and reciprocal mode derives the down interval from the up interval. An invalid ratio entered during an edit can retain the last valid ratio. A blocked or full store leaves preferences available for the current session.

The composition carries musical choices such as its written BaseNote duration, repeat interval and explicitly assigned instruments. The browser separately keeps display preferences, audio settings and the module-bar layout, including its Start/End drop choice. [Score format](/reference/module-schema) · [Module bar](/user-guide/interface/module-bar)
