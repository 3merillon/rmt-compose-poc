// Drive the built docs site: check images, tables, details blocks, console errors.
import { chromium } from 'playwright';

const BASE = 'http://localhost:4173';
const PAGES = [
  '/', // home
  '/getting-started/first-composition',
  '/user-guide/interface/settings',
  '/user-guide/interface/themes',
  '/user-guide/notes/transposing',
  '/user-guide/modules/module-library',
  '/user-guide/playback/audio',
  '/reference/settings-reference',
  '/reference/expressions/syntax',
  '/developer/performance',
  '/developer/audio/audio-graph',
  '/developer/wasm/overview',
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(['pageerror', page.url(), e.message]));
page.on('console', (m) => { if (m.type() === 'error') errs.push(['console', page.url(), m.text()]); });
page.on('response', (r) => { if (r.status() >= 400) errs.push(['http ' + r.status(), page.url(), r.url()]); });

let fail = 0;
for (const p of PAGES) {
  await page.goto(BASE + p, { waitUntil: 'networkidle' });
  const r = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('.vp-doc img')];
    const badImgs = imgs.filter((i) => !i.naturalWidth).map((i) => i.getAttribute('src'));
    return {
      title: document.title,
      h1: document.querySelector('h1')?.textContent?.trim() ?? '(none)',
      imgs: imgs.length,
      badImgs,
      tables: document.querySelectorAll('.vp-doc table').length,
      details: document.querySelectorAll('.vp-doc details').length,
      containers: document.querySelectorAll('.vp-doc .custom-block').length,
      codeBlocks: document.querySelectorAll('.vp-doc div[class*="language-"]').length,
      textLen: document.querySelector('.vp-doc')?.textContent?.length ?? 0,
    };
  });
  const ok = r.textLen > 500 && r.badImgs.length === 0 && r.h1 !== '(none)';
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${p}`);
  console.log(`   h1="${r.h1}" text=${r.textLen} imgs=${r.imgs}${r.badImgs.length ? ' BROKEN:' + r.badImgs.join(',') : ''} tables=${r.tables} details=${r.details} blocks=${r.containers} code=${r.codeBlocks}`);
}

console.log('\n--- errors captured:', errs.length, '---');
errs.slice(0, 10).forEach((e) => console.log(' ', e.join(' | ')));
console.log(fail === 0 && errs.length === 0 ? '\nALL RENDERED CHECKS PASS' : `\n${fail} page failures, ${errs.length} errors`);
await browser.close();
