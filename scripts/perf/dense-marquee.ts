import type { Page } from 'playwright';
import assert from 'node:assert/strict';

// Called with the dense-playback fixture fully in view and Play running.
export async function checkDenseMarquee(page: Page, count: number) {
  const corners = await page.evaluate(() => {
    const tracking = document.querySelector<HTMLInputElement>('#trackingToggle')!;
    if (tracking.checked) tracking.click();
    const r = window.__rmtRenderer!;
    const m = r.matrix, p = r.posSize!;
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    for (let i = 0; i < p.length; i += 4) {
      const x0 = p[i] * m[0] + m[6], x1 = x0 + p[i + 2] * m[0];
      const y0 = p[i + 1] * m[4] + m[7], y1 = y0 + p[i + 3] * m[4];
      left = Math.min(left, x0, x1);
      right = Math.max(right, x0, x1);
      top = Math.min(top, y0, y1);
      bottom = Math.max(bottom, y0, y1);
    }
    window.marqueeFrames = [];
    window.measureMarquee = true;
    let last: number | undefined;
    requestAnimationFrame(function sample(time) {
      if (last !== undefined) window.marqueeFrames.push(time - last);
      last = time;
      if (window.measureMarquee) requestAnimationFrame(sample);
    });
    return { left: left - 8, right: right + 8, top: top - 12, bottom: bottom + 12 };
  });
  await page.mouse.move(corners.left, corners.top);
  await page.keyboard.down('Shift');
  await page.mouse.down();
  assert.equal(await page.evaluate(() => window.__rmtWorkspace!._interaction.type), 'marquee');
  await page.mouse.move(corners.right, corners.bottom, { steps: 75 });
  const preview = await page.evaluate(() => {
    window.measureMarquee = false;
    const frames = window.marqueeFrames.slice().sort((a: number, b: number) => a - b);
    return { frames: frames.length, p95: frames[Math.floor(frames.length * 0.95)],
      hits: window.__rmtRenderer!.getMultiSelection().length };
  });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  const result = await page.evaluate(() => ({
    committed: window.__rmtRenderer!.getMultiSelection().length,
    lateStarts: window.starts.filter(note => note.lead < 0).length,
    glError: window.__rmtRenderer!.gl!.getError(),
  }));
  console.log(JSON.stringify({ mode: 'marquee', ...preview, ...result }));
  assert.equal(preview.hits, count);
  assert.equal(result.committed, count);
  assert.equal(result.lateStarts, 0);
  assert.equal(result.glError, 0);
  await page.locator('[data-action="clear-selection"]').click();
}
