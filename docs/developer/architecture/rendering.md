# Rendering pipeline

The score is a WebGL2 canvas over a workspace container. The DOM supplies controls and editors. A numbered note in a score does not acquire its own DOM element.

**Score → world.** Time determines the horizontal position and width. Pitch height is proportional to the logarithm of the frequency ratio to the BaseNote, so each octave has the same vertical span. The two density settings scale these axes independently. Amplitude can change body height. Rests, references, bar markers and the BaseNote have distinct representations.

**World → screen.** The [camera](/developer/rendering/camera-controller) supplies a common pan and zoom basis. The renderer keeps the instance order for drawing and uses visible ranges to limit work. Above the visible-note cutoff it retains detail for the hovered or individually selected note. Bar markers, note bodies and selection remain available for interaction. [Renderer implementation](/developer/rendering/webgl2-renderer)

**Screen → score.** The workspace resolves input against the CPU picking data. A note body, its resize tab, a transpose arrow and a measure triangle can lead to different gestures. The GPU draws the marquee preview and rings. The released rectangle is resolved on the CPU, including the measure markers. [Picking](/developer/rendering/picking)

**Edit → redraw.** A change can update a few stable slots, require a full scene sync, or change only the camera, playhead or selection. View, scene, position, drag and colour revisions keep cached geometry and text from surviving a change that affects them. An unchanged workspace can skip drawing on its next animation frame. [Measured performance](/developer/performance)
