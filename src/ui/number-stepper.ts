/**
 * Up/down steppers for every <input type="number">, drawn in the app's own style.
 *
 * The browser's spin buttons cannot be styled, only filtered; the old filter
 * tinted them a muddy yellow and turned them red on hover. They are hidden in
 * styles.css, and each number field is wrapped here with two chevron buttons
 * that look and hover like the library toolbar's buttons (accent stroke, accent
 * border and a light accent fill; never red). Fields added later (the Settings
 * panel builds its tabs on demand) are picked up by a MutationObserver.
 *
 * A step changes the value through stepUp()/stepDown() semantics: min, max and
 * step are honoured, and `input` then `change` fire, exactly as the native
 * arrows did, so every existing listener keeps working. A field whose step is
 * "any" steps by data-step when set, else by the decade of its value (0.3 steps
 * by 0.1, 2 by 1). Holding a button repeats.
 */

const ICON_UP = '<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 7.5 6 4.5 9 7.5"/></svg>';
const ICON_DOWN = '<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 4.5 6 7.5 9 4.5"/></svg>';

function decimalsOf(x: number) {
  const s = String(x);
  if (s.includes('e-')) return Number(s.split('e-')[1]) || 0;
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

function stepOf(input: HTMLInputElement, value: number) {
  const ds = parseFloat(input.dataset.step ?? '');
  if (Number.isFinite(ds) && ds > 0) return ds;
  const st = parseFloat(input.step);
  if (Number.isFinite(st) && st > 0) return st;
  const a = Math.abs(value);
  return a > 0 && Number.isFinite(a) ? Math.pow(10, Math.floor(Math.log10(a))) : 1;
}

/** Step `input` once in direction dir (+1 / -1). Exported for tests. */
export function stepNumberInput(input: HTMLInputElement, dir: number) {
  if (!input || input.disabled || input.readOnly) return;
  const cur = parseFloat(input.value);
  const min = parseFloat(input.min), max = parseFloat(input.max);
  const base = Number.isFinite(cur) ? cur : (Number.isFinite(min) ? min : 0);
  const step = stepOf(input, base);
  let next = base + dir * step;
  // Round to the step's precision so 0.1 + 0.2 shows as 0.3, not 0.30000000000000004.
  const places = Math.min(10, Math.max(decimalsOf(step), decimalsOf(base)));
  next = Number(next.toFixed(places));
  if (Number.isFinite(min) && next < min) next = min;
  if (Number.isFinite(max) && next > max) next = max;
  if (Number.isFinite(cur) && next === cur) return;
  input.value = String(next);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function makeButton(input: HTMLInputElement, dir: number) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'rmt-stepper-btn ' + (dir > 0 ? 'rmt-stepper-up' : 'rmt-stepper-down');
  b.tabIndex = -1;                       // the field itself keeps the arrow keys
  b.setAttribute('aria-label', dir > 0 ? 'Increase' : 'Decrease');
  b.innerHTML = dir > 0 ? ICON_UP : ICON_DOWN;
  let delay: number | undefined, repeat: number | undefined;
  const stop = () => { clearTimeout(delay); clearInterval(repeat); delay = repeat = undefined; };
  b.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();                  // keep focus (and an open edit) in the field
    stepNumberInput(input, dir);
    delay = window.setTimeout(() => { repeat = window.setInterval(() => stepNumberInput(input, dir), 70); }, 420);
  });
  b.addEventListener('pointerup', stop);
  b.addEventListener('pointerleave', stop);
  b.addEventListener('pointercancel', stop);
  return b;
}

/** Wrap one number field with the steppers (idempotent). */
export function enhanceNumberInput(input: HTMLInputElement) {
  if (!input || input.dataset.rmtStepper === '1' || input.type !== 'number') return;
  if (!input.parentNode) return;
  input.dataset.rmtStepper = '1';
  const wrap = document.createElement('span');
  wrap.className = 'rmt-stepper';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);
  const col = document.createElement('span');
  col.className = 'rmt-stepper-col';
  col.appendChild(makeButton(input, +1));
  col.appendChild(makeButton(input, -1));
  wrap.appendChild(col);
}

function scan(root: Element) {
  if (!root || !root.querySelectorAll) return;
  if (root instanceof HTMLInputElement && root.type === 'number') enhanceNumberInput(root);
  root.querySelectorAll<HTMLInputElement>('input[type="number"]').forEach(enhanceNumberInput);
}

export const initNumberSteppers: { (): void; done?: boolean } = function init() {
  if (typeof document === 'undefined' || initNumberSteppers.done) return;
  initNumberSteppers.done = true;
  scan(document.body);
  new MutationObserver((records) => {
    for (const r of records) for (const n of r.addedNodes) if (n instanceof Element) scan(n);
  }).observe(document.body, { childList: true, subtree: true });
}
