import type { Page } from 'playwright';
// Pointer paths for the real Play-button benchmark. Samples actual workspace events
// and verifies both hit and miss rows, including note selection and stack cycling.
export async function checkDensePointer(page: Page, count: number) {
  const points = await page.evaluate(async () => {
    const ws = window.__rmtWorkspace!, r = ws.renderer!;
    ws.camera!.tx = 170;
    ws.camera!.ty = 300;
    ws.camera!.onChange!();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const points = [], m = r.matrix;
    for (let n = 0; n < 80; n++) {
      const i = Math.min(r.instanceCount - 1, Math.floor((.1 + .8 * n / 80) * r.instanceCount / 8) * 8 + n % 8);
      const o = 4 * i;
      points.push([m[0] * (r.posSize![o] + r.posSize![o + 2] / 2) + m[6],
        m[4] * (r.posSize![o + 1] + r.posSize![o + 3] / 2) + m[7]]);
    }
    const probe = window.pointerProbe = { events: [] as number[], frames: [] as number[], hits: 0, stop: new AbortController() };
    const options = { signal: probe.stop.signal };
    let begin = 0, last = 0;
    ws.containerEl!.addEventListener('pointermove', () => { begin = performance.now(); }, { ...options, capture: true });
    ws.containerEl!.addEventListener('pointermove', () => {
      probe.events.push(performance.now() - begin);
      if (r._hoveredNoteId != null) probe.hits++;
    }, options);
    requestAnimationFrame(function sample(t) {
      if (probe.stop.signal.aborted) return;
      if (last) probe.frames.push(t - last);
      last = t;
      requestAnimationFrame(sample);
    });
    return points;
  });
  for (const onNotes of [true, false]) {
    await page.evaluate(() => {
      window.pointerProbe.events.length = window.pointerProbe.frames.length = 0;
      window.pointerProbe.hits = 0;
      window.starts.length = 0;
    });
    for (const [x, y] of points) await page.mouse.move(x, onNotes ? y : 680);
    const result = await page.evaluate(() => {
      const quantiles = (values: number[]) => {
        const sorted = values.slice().sort((a: number,b: number) => a-b);
        const at = (q: number) => +(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] || 0).toFixed(2);
        return { p50: at(.5), p95: at(.95), max: at(1) };
      };
      const { events, frames, hits } = window.pointerProbe;
      return { events: events.length, hits, pointerMs: quantiles(events), frameMs: quantiles(frames),
        starts: window.starts.length, lateStarts: window.starts.filter(s => s.lead < 0).length };
    });
    console.log(JSON.stringify({ count, mode: onNotes ? 'hover notes' : 'hover background', ...result }));
    if (!result.events || result.hits !== (onNotes ? result.events : 0) || !result.starts || result.lateStarts) {
      throw Error('Pointer sweep missed its target or audio scheduling deadline');
    }
  }
  await page.evaluate(() => window.pointerProbe.stop.abort());
  const [x, y] = points[Math.floor(points.length / 2)];
  const stack = await page.evaluate(([x,y]) => window.__rmtWorkspace!.pickStackAt(x, y, 3), [x,y]);
  const expected = stack[0];
  if (expected?.type !== 'note') throw Error('Click target is outside a note');
  for (let i = 0; i < Math.min(3, stack.length); i++) {
    await page.mouse.click(x, y);
    const selected = await page.evaluate(() => window.__rmtRenderer!._lastSelectedNoteId);
    console.log(JSON.stringify({ count, mode: 'click', depth: stack.length, selected }));
    if (selected !== stack[i].id) throw Error('Unexpected stack selection');
  }
  // Leave the remaining fixture checks with unobstructed canvas coordinates.
  await page.evaluate(() => document.querySelector<HTMLElement>('.note-widget-close')?.click());
}
