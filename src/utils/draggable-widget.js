/**
 * Drag behavior shared by the app's floating panels — the note-variables widget
 * and the settings panel.
 *
 * Lifted from the note widget's original implementation (previously inline in
 * modals/index.js, with a dead byte-copy rotting in player.js) so both panels
 * feel the same: drag by a header handle, position via inline left/top, clamped
 * so a panel can never be pushed under the top bar or off the viewport, and
 * re-clamped when the window resizes.
 *
 * Two fixes over the original: `touchcancel` now ends a drag (an interrupted
 * touch used to leave the widget stuck mid-drag with document listeners still
 * attached), and the geometry the clamp needs is measured once per drag instead
 * of re-read on every move. The post-move `onMove()` hook still reads layout
 * after writing left/top, so a drag is not layout-free — it is just no longer
 * paying for the same measurements three times a frame.
 */

// The fixed top bar is 50px tall; floating panels stay below it, and keep a
// 19px buffer to every viewport edge.
export const TOP_HEADER_HEIGHT = 50;
export const MIN_BUFFER = 19;

// Floating panels share one stacking level: above the menu bars (1100/1099),
// below global modals (2000). The panel you touch last comes to the front, so
// two open panels can never trap each other.
const BASE_Z = 1200;
const FRONT_Z = 1201;

const widgets = new Set();

export function raiseWidget(el) {
  // With a single panel there is nothing to stack against — leave its z-index
  // to CSS, exactly as before this helper existed.
  if (!el || widgets.size < 2) return;
  for (const other of widgets) {
    if (other !== el) other.style.zIndex = String(BASE_Z);
  }
  el.style.zIndex = String(FRONT_Z);
}

// Touch list must be probed before clientX/clientY: a MouseEvent has no `.touches`,
// and a coordinate of 0 is falsy, so `e.clientY || e.touches[0].clientY` throws at
// the viewport edge.
export function pointerOf(e) {
  if (e.touches && e.touches.length > 0) {
    return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  if (e.changedTouches && e.changedTouches.length > 0) {
    return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
  }
  return { x: e.clientX, y: e.clientY };
}

/**
 * Make `el` draggable by `handle`.
 *
 * @param {object} o
 * @param {HTMLElement} o.el            the panel to move
 * @param {HTMLElement} o.handle        the drag handle (its header)
 * @param {() => void} [o.onMove]       run after every move and on resize —
 *                                      where a panel re-fits its height
 * @param {() => boolean} [o.isVisible] resize re-clamping is skipped when false
 * @param {(e: Event) => boolean} [o.ignoreDragStart]
 *                                      veto a drag starting on this target
 *                                      (close buttons, controls in the header)
 * @returns {{ destroy: () => void, clampIntoView: () => void, raise: () => void }}
 */
export function makeDraggableWidget({
  el,
  handle,
  onMove = () => {},
  isVisible = () => true,
  ignoreDragStart = () => false,
}) {
  if (!el || !handle) return { destroy() {}, clampIntoView() {}, raise() {} };

  el.style.position = 'fixed';
  widgets.add(el);

  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  // Measured once per drag: neither can change while the pointer is down (width
  // is CSS-owned, the handle is a fixed-height header), and re-reading them on
  // every move forced a synchronous layout per mousemove.
  let dragWidth = 0;
  let dragHandleHeight = 0;

  function startDrag(e) {
    if (ignoreDragStart(e)) return;
    isDragging = true;
    e.preventDefault();
    raiseWidget(el);

    const rect = el.getBoundingClientRect();
    const { x, y } = pointerOf(e);
    dragOffsetX = x - rect.left;
    dragOffsetY = y - rect.top;
    dragWidth = rect.width;
    dragHandleHeight = handle.getBoundingClientRect().height || TOP_HEADER_HEIGHT;

    document.addEventListener('mousemove', duringDrag);
    document.addEventListener('touchmove', duringDrag, { passive: false });
    document.addEventListener('mouseup', endDrag);
    document.addEventListener('touchend', endDrag);
    document.addEventListener('touchcancel', endDrag);
  }

  function duringDrag(e) {
    if (!isDragging) return;
    e.preventDefault();

    const { x, y } = pointerOf(e);

    const maxLeft = window.innerWidth - dragWidth - MIN_BUFFER;
    const newLeft = Math.max(MIN_BUFFER, Math.min(x - dragOffsetX, maxLeft));

    // Only the handle has to stay on screen: a panel may hang off the bottom,
    // and onMove() shrinks it to fit.
    const minTop = TOP_HEADER_HEIGHT + MIN_BUFFER;
    const maxTop = window.innerHeight - dragHandleHeight - MIN_BUFFER;
    const newTop = Math.max(minTop, Math.min(y - dragOffsetY, maxTop));

    el.style.left = newLeft + 'px';
    el.style.top = newTop + 'px';

    onMove();
  }

  function endDrag() {
    isDragging = false;
    document.removeEventListener('mousemove', duringDrag);
    document.removeEventListener('touchmove', duringDrag);
    document.removeEventListener('mouseup', endDrag);
    document.removeEventListener('touchend', endDrag);
    document.removeEventListener('touchcancel', endDrag);
  }

  // Pull an off-screen panel back in. Runs on window resize, and on demand
  // after something changes the panel's size.
  function clampIntoView() {
    if (!isVisible()) return;

    const handleHeight = handle.getBoundingClientRect().height;
    const rect = el.getBoundingClientRect();

    const availableHeight = window.innerHeight - TOP_HEADER_HEIGHT + 5;
    const maxWidgetHeight = availableHeight - handleHeight;

    const maxLeft = window.innerWidth - rect.width - MIN_BUFFER;
    const maxTop = window.innerHeight - Math.min(rect.height, maxWidgetHeight) - MIN_BUFFER;

    if (rect.right > window.innerWidth - MIN_BUFFER) {
      el.style.left = Math.max(MIN_BUFFER, maxLeft) + 'px';
    }
    if (rect.bottom > window.innerHeight - MIN_BUFFER) {
      el.style.top = Math.max(TOP_HEADER_HEIGHT + MIN_BUFFER, maxTop) + 'px';
    }
    if (rect.top < TOP_HEADER_HEIGHT + MIN_BUFFER) {
      el.style.top = (TOP_HEADER_HEIGHT + MIN_BUFFER) + 'px';
    }

    onMove();
  }

  const onWindowResize = () => clampIntoView();
  const onPress = () => raiseWidget(el);

  handle.addEventListener('mousedown', startDrag);
  handle.addEventListener('touchstart', startDrag, { passive: false });
  el.addEventListener('mousedown', onPress);
  el.addEventListener('touchstart', onPress, { passive: true });
  window.addEventListener('resize', onWindowResize);

  return {
    destroy() {
      endDrag();
      handle.removeEventListener('mousedown', startDrag);
      handle.removeEventListener('touchstart', startDrag);
      el.removeEventListener('mousedown', onPress);
      el.removeEventListener('touchstart', onPress);
      window.removeEventListener('resize', onWindowResize);
      widgets.delete(el);
    },
    clampIntoView,
    raise: () => raiseWidget(el),
  };
}
