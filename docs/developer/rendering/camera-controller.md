# Camera controller

`CameraController` attaches pointer and wheel listeners to the workspace container. It owns a uniform zoom (`scale`), translation (`tx`, `ty`), and the element’s viewport offset. `getBasis()` supplies an affine transform to the renderer. The workspace’s persisted X/Y density factors are separate score-to-world scales.

## Coordinate conversion

`screenToWorld(clientX, clientY)` subtracts the container offset and camera translation before dividing by zoom. `worldToScreen(x, y)` returns coordinates local to the container. Add the container offset when comparing that result with a pointer event’s client coordinates. `getBasis()` already includes the offset in its translation.

## Input and tracking

Wheel zoom anchors at the pointer. Ctrl-wheel over the workspace uses the same camera zoom. Pinch uses the touch midpoint. The camera clamps zoom to 0.1–10. With playhead tracking on, user horizontal panning is locked and the zoom anchor uses the middle of the view horizontally. Vertical movement is still available.

`setInputEnabled` gates camera input during an interaction. `setSingleFingerPanEnabled` can reserve one finger for editing while leaving a pinch available. Workspace gesture ownership, including a hold or Shift-drag starting on a note, is described in [Picking](/developer/rendering/picking). `destroy()` releases the listeners. [Workspace navigation](/user-guide/interface/workspace)
