# Create a reusable module

A module can be a complete piece or a phrase you place against another note. Decide which relationships should move together. For example, suppose a three-note chord should follow a new tonic, and you also want to be able to transpose the whole chord by editing its lowest voice.

1. Save the current score. Click the BaseNote, find **Clean Slate** and confirm. Select the BaseNote again.
2. Use **Add Note / Silence** to create the root at **At Start**. Set its frequency to `base.f` and duration to `base.d * 2`. Read the new note’s ID. The following example uses 1.
3. Select the root and create two more notes **At Start**. Set their frequency, start and duration as shown. Use the actual root ID if it differs.

| Voice | Frequency | Start | Duration |
|---|---|---|---|
| Root | `base.f` | `base.t` | `base.d * 2` |
| Third | `[1].f * (5/4)` | `[1].t` | `[1].d` |
| Fifth | `[1].f * (3/2)` | `[1].t` | `[1].d` |

Play the chord. Transpose its root and hear all three pitches follow. Undo and double the root’s duration. All three notes should release together. In the shipped **Major** chord, each pitch reads `base.f` directly, so moving just its sounding root produces a different result. [Tutorial on building a triad](/tutorials/beginner/major-triad)

Choose **+ → Save Module** to download your example. Press a section’s dashed **+** tile to upload it to the library. You can also [copy a selection](/user-guide/notes/selection). Drop the tile onto a pitched note. Use **End** to hear the chord as its answer or **Start** to hear the two together. The host’s BaseNote supplies the time unit. [Drop targets and timing](/user-guide/modules/loading-modules#where-you-can-drop)

For longer examples, try a silent harmonic root for each chord as in [the shipped progressions](/tutorials/workflows/canon-and-cadences). For JSON fields and an example you can save as a file, see [Module format](/user-guide/modules/module-format).
