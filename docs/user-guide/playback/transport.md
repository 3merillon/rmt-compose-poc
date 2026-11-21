# Transport controls

![The top bar with Play/Pause, Stop and master volume on the left](/img/top-bar.png)

| To hear… | Action |
|---|---|
| The piece from the beginning | Press **Stop**, then **Play**. In a fresh session Play starts the canon. |
| A passage from the current position | Press **Play**. The playhead moves once playback begins. |
| The rest of the piece after a pause | Press **Pause** to park the playhead, then **Play** to resume there. |
| A different entrance | Click or tap empty canvas at the desired time. If playback was running, it parks there. Press **Play** to hear the new passage. |
| A fresh attack from time zero | Press **Stop**. It rewinds and clears the current loop. |

At the natural end, releases and reverb can ring beyond the written note-off. Pressing Play again starts from the beginning. The master slider on the left shares its value with **Settings → Audio**. If you want the playhead to stay on screen during a long piece, turn on [Playhead tracking](/user-guide/playback/tracking).

## Loop playback

Shift-click **Play** or hold it on touch to arm a loop. From rest, that gesture also starts playback. During playback it arms the loop in the current pass. The loop indicator stays visible while armed. A second loop gesture disarms it and lets the current pass finish. **Stop** ends it immediately and rewinds. **Pause** leaves loop mode. Seeking during a loop parks the playhead with the mode still armed, ready for the next Play. A loop needs audible pitched material and a period of at least 50 ms.

### Rising or falling each time round

The canon’s BaseNote has a **REPEAT** ratio of `9/8`. Listen to its opening again after the seam. The second pass sounds a whole tone higher. All voices transpose together, so their intervals are preserved. You can see the current pass’s frequency in the BaseNote circle and note widget. Pausing keeps the pass’s pitch for a resume. Stopping restores the written pitch.

Set a different repeat in the BaseNote widget. **Settings → Audio → Transpose each repeat by** edits this same score value for a rational repeat. **Keep within an octave** is a browser preference that folds the accumulating transposition by octaves. Six pure whole tones exceed an octave by `531441/524288`, about 23.5 cents. With folding on, that small rise is audible over successive groups of six passes.

## Tempo and sound

The live tempo slider is in the module bar. Change the speed during playback, double-click to return to the written tempo, or press the check mark to save the new pace into the score. [Live tempo](/user-guide/interface/module-bar#live-tempo)

To change the timbre of a line, choose its instrument in the note widget. To audition pure intervals against a keyboard tuning, use **Settings → Audio → Play tempered (12-TET)**. [Instruments](/user-guide/playback/instruments) · [Audio settings](/user-guide/playback/audio)
