/**
 * Procedural SVG icons for the module library (Phase 6.2).
 *
 * Each icon is a self-contained, family-hued rounded tile:
 *   - simple ratios  (e.g. 3/2)   -> a stacked fraction with a bar
 *   - TET steps      (e.g. 7\12)  -> the backslash step notation
 *   - colon ratios   (e.g. 4:5:6) -> the chord ratio, centred
 *   - everything else             -> the module name, word-wrapped
 * plus an optional cents caption for intervals.
 *
 * Family hue identifies the module family at a glance; the ink colour is chosen
 * per-hue for legibility, so a tile reads on both light and dark themes. Hover
 * glow / borders come from the surrounding .icon element (theme accent).
 */

// Family -> tile hue. Higher-limit + comma aliases fold into a canonical key.
const FAMILY_HUES = {
  '3-limit':     '#f2a71b', // amber   — Pythagorean / perfect
  '5-limit':     '#3fb950', // green   — classic just intonation
  '7-limit':     '#4a90e2', // blue    — septimal
  'higher':      '#9b6dff', // violet  — 11/13/17/19/23-limit
  'comma':       '#9aa0a6', // gray    — commas / microintervals
  'tet':         '#35c4d7', // cyan    — equal temperament steps
  'scale':       '#35c4d7', // cyan    — scale systems
  'chord':       '#ff7a59', // coral
  'progression': '#e857b0', // magenta
  'cadence':     '#e857b0', // magenta (progression sibling)
  'melody':      '#2fb3a0', // teal
  'default':     '#f2a71b',
};

const FAMILY_ALIAS = {
  '11-limit': 'higher', '13-limit': 'higher', '17-limit': 'higher',
  '19-limit': 'higher', '23-limit': 'higher', 'higher-limit': 'higher',
  'commas': 'comma',
};

export function familyHue(family) {
  const key = FAMILY_ALIAS[family] || family;
  return FAMILY_HUES[key] || FAMILY_HUES.default;
}

// Relative luminance (sRGB) → legible ink colour for text on the hue.
function inkFor(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.45 ? '#181019' : '#ffffff';
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Greedy word/char wrap into at most `maxLines` lines aiming for ~maxChars each.
function wrapLines(text, maxChars, maxLines) {
  const words = String(text).trim().split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (!cur) { cur = w; continue; }
    if ((cur.length + 1 + w.length) <= maxChars) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  // Hard-break any single line that is still too long (e.g. "Greensleeves").
  const out = [];
  for (const ln of lines) {
    let s = ln;
    while (s.length > maxChars + 2 && out.length < maxLines - 1) {
      out.push(s.slice(0, maxChars));
      s = s.slice(maxChars);
    }
    out.push(s);
  }
  if (out.length <= maxLines) return out;
  // Too many lines: keep the first maxLines, ellipsize the last.
  const kept = out.slice(0, maxLines);
  kept[maxLines - 1] = kept[maxLines - 1].slice(0, Math.max(1, maxChars - 1)) + '…';
  return kept;
}

function fractionMarkup(num, den, size, ink, meta, showCents) {
  const cx = size / 2;
  const cents = meta && meta.cents != null ? meta.cents : null;
  const hasCents = showCents && cents != null;
  const maxDigits = Math.max(num.length, den.length);
  const fs = size * (maxDigits >= 6 ? 0.17 : maxDigits >= 5 ? 0.20 : maxDigits >= 4 ? 0.25 : maxDigits >= 3 ? 0.30 : 0.36);
  const centerY = hasCents ? size * 0.42 : size * 0.5;
  const gap = fs * 0.62;
  const barW = Math.min(size * 0.66, Math.max(fs * maxDigits * 0.66, fs * 0.9) + size * 0.06);
  const barH = Math.max(1.4, size * 0.032);
  const font = `font-family:'Roboto Mono',monospace;font-weight:700;fill:${ink}`;
  let s = '';
  s += `<text x="${cx}" y="${(centerY - gap).toFixed(2)}" text-anchor="middle" dominant-baseline="central" style="${font};font-size:${fs.toFixed(2)}px">${num}</text>`;
  s += `<rect x="${(cx - barW / 2).toFixed(2)}" y="${(centerY - barH / 2).toFixed(2)}" width="${barW.toFixed(2)}" height="${barH.toFixed(2)}" rx="${(barH / 2).toFixed(2)}" fill="${ink}"/>`;
  s += `<text x="${cx}" y="${(centerY + gap).toFixed(2)}" text-anchor="middle" dominant-baseline="central" style="${font};font-size:${fs.toFixed(2)}px">${den}</text>`;
  if (hasCents) {
    const cs = Math.round(cents * 10) / 10;
    const label = (Number.isInteger(cs) ? cs.toFixed(0) : cs.toFixed(1)) + '¢';
    s += `<text x="${cx}" y="${(size * 0.85).toFixed(2)}" text-anchor="middle" dominant-baseline="central" style="font-family:'Roboto Mono',monospace;font-weight:500;fill:${ink};opacity:0.72;font-size:${(size * 0.155).toFixed(2)}px">${esc(label)}</text>`;
  }
  return s;
}

function labelMarkup(text, size, ink, opts = {}) {
  const t = String(text || '').trim();
  if (!t) return '';
  const caption = opts.caption ? String(opts.caption).trim() : '';
  const maxChars = opts.big ? 6 : 8;
  const maxLines = opts.big ? 1 : (caption ? 2 : 3);
  const lines = wrapLines(t, maxChars, maxLines);
  const longest = lines.reduce((a, l) => Math.max(a, l.length), 1);
  // Font size fits the longest line to ~86% width (Roboto Mono advance ≈ 0.60em).
  let fs = Math.min(size * (opts.big ? 0.40 : 0.30), (size * 0.86) / (longest * 0.60));
  fs = Math.max(fs, size * 0.13);
  const lineH = fs * 1.16;
  const cy = caption ? size * 0.41 : size / 2;
  const startY = cy - (lines.length - 1) * lineH / 2;
  const font = `font-family:'Roboto Mono',monospace;font-weight:600;fill:${ink}`;
  let s = lines
    .map((ln, i) => `<text x="${size / 2}" y="${(startY + i * lineH).toFixed(2)}" text-anchor="middle" dominant-baseline="central" style="${font};font-size:${fs.toFixed(2)}px">${esc(ln)}</text>`)
    .join('');
  if (caption) {
    const cfs = Math.min(size * 0.165, (size * 0.9) / (caption.length * 0.60));
    s += `<text x="${size / 2}" y="${(size * 0.82).toFixed(2)}" text-anchor="middle" dominant-baseline="central" style="font-family:'Roboto Mono',monospace;font-weight:500;fill:${ink};opacity:0.78;font-size:${cfs.toFixed(2)}px">${esc(caption)}</text>`;
  }
  return s;
}

/**
 * Return SVG markup (string) for a module icon.
 * @param {object} meta  { name, ratio?, cents?, family?, tags? }
 * @param {number} sizePx  tile edge length in px
 * @param {object} opts  { showCents?, name? }
 */
export function moduleIconSvg(meta, sizePx, opts = {}) {
  const size = Math.max(24, Math.round(sizePx || 56));
  const family = (meta && meta.family) || 'default';
  const hue = familyHue(family);
  const ink = inkFor(hue);
  const showCents = opts.showCents !== false;
  const ratio = meta && meta.ratio ? String(meta.ratio).trim() : '';
  const name = (meta && meta.name) || opts.name || '';
  const r = Math.round(size * 0.14);

  const bg = `<rect x="0.5" y="0.5" width="${size - 1}" height="${size - 1}" rx="${r}" ry="${r}" fill="${hue}"/>`;
  const sheen = `<rect x="0.5" y="0.5" width="${size - 1}" height="${(size * 0.5).toFixed(1)}" rx="${r}" ry="${r}" fill="#ffffff" opacity="0.07"/>`;

  const simpleFrac = /^(\d+)\s*\/\s*(\d+)$/.exec(ratio);
  const tetStep = /^(\d+)\s*\\\s*(\d+)$/.exec(ratio);
  const colonRatio = ratio.includes(':');

  let inner;
  if (simpleFrac) inner = fractionMarkup(simpleFrac[1], simpleFrac[2], size, ink, meta, showCents);
  else if (tetStep) inner = labelMarkup(`${tetStep[1]}\\${tetStep[2]}`, size, ink, { big: true });
  else if (colonRatio) inner = labelMarkup(name || ratio, size, ink, { caption: ratio }); // chord: name + ratio caption
  else inner = labelMarkup(name, size, ink, { big: false });

  return `<svg viewBox="0 0 ${size} ${size}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;height:100%">${bg}${sheen}${inner}</svg>`;
}

/**
 * Render the icon SVG into a container element (clears it first).
 */
export function renderModuleIcon(container, meta, sizePx, opts = {}) {
  if (!container) return;
  container.innerHTML = moduleIconSvg(meta, sizePx, opts);
}
