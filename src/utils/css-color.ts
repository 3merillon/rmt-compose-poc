/**
 * A note's colour, as the renderer needs it: [r, g, b, a], each in 0..1.
 *
 * Fast paths for the forms the app writes itself (rgba(), hsla(), #hex). Any
 * other CSS colour a note can be given (rgb() without alpha, a colour name,
 * spaces, the space-separated syntax) is resolved by the browser through a 2D
 * canvas, which knows every CSS colour, and its normalised form is parsed. A
 * string the browser does not take as a colour gives null, and the caller falls
 * back to its own colour.
 */

export type RGBA = [number, number, number, number];

/** HSL to RGBA (h in degrees, s and l in 0..100, a in 0..1). */
export function hslaToRgba(h: number, s: number, l: number, a?: number | null): RGBA {
  h = (h % 360 + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs(hp % 2 - 1));
  let r = 0, g = 0, b = 0;
  if (0 <= hp && hp < 1) { r = c; g = x; b = 0; }
  else if (1 <= hp && hp < 2) { r = x; g = c; b = 0; }
  else if (2 <= hp && hp < 3) { r = 0; g = c; b = x; }
  else if (3 <= hp && hp < 4) { r = 0; g = x; b = c; }
  else if (4 <= hp && hp < 5) { r = x; g = 0; b = c; }
  else if (5 <= hp && hp < 6) { r = c; g = 0; b = x; }
  const m = l - c / 2;
  return [r + m, g + m, b + m, a != null ? a : 1];
}

function parseDirect(s: string): RGBA | null {
  if (s.startsWith('rgb')) {
    const m = s.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/);
    if (m) return [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255, m[4] != null ? Number(m[4]) : 1];
  } else if (s.startsWith('hsl')) {
    const m = s.match(/^hsla?\(([^,]+),\s*([^,]+)%,\s*([^,]+)%(?:,\s*([\d.]+))?\)$/);
    if (m) return hslaToRgba(Number(m[1]), Number(m[2]), Number(m[3]), m[4] != null ? Number(m[4]) : 1);
  } else if (s.startsWith('#')) {
    let hex = s.slice(1);
    if (!/^[0-9a-f]+$/.test(hex)) return null;
    if (hex.length === 3 || hex.length === 4) hex = hex.split('').map((ch) => ch + ch).join('');
    if (hex.length === 6 || hex.length === 8) {
      const byte = (i: number) => parseInt(hex.slice(i, i + 2), 16) / 255;
      return [byte(0), byte(2), byte(4), hex.length === 8 ? byte(6) : 1];
    }
  }
  return null;
}

let ctx2d: CanvasRenderingContext2D | null | undefined;
// The browser's own reading of a CSS colour: '#rrggbb' or 'rgba(r, g, b, a)', or
// null when it is not a colour (or there is no DOM, as in node).
function browserNormalise(s: string): string | null {
  if (ctx2d === undefined) {
    try { ctx2d = document.createElement('canvas').getContext('2d'); } catch { ctx2d = null; }
  }
  if (!ctx2d) return null;
  // Two different sentinels: a string the browser rejects leaves fillStyle unchanged
  ctx2d.fillStyle = '#000001';
  ctx2d.fillStyle = s;
  const a = ctx2d.fillStyle;
  ctx2d.fillStyle = '#000002';
  ctx2d.fillStyle = s;
  const b = ctx2d.fillStyle;
  return a === b ? a : null;
}

/**
 * @param {string} col any CSS colour
 * @param {(s: string) => string|null} [normalise] how to resolve what the fast
 *        paths do not read (default: the browser, through a 2D canvas)
 * @returns {number[]|null} [r, g, b, a] in 0..1
 */
export function parseCssColor(col: unknown, normalise = browserNormalise) {
  if (typeof col !== 'string') return null;
  const s = col.trim().toLowerCase();
  if (!s) return null;
  const direct = parseDirect(s);
  if (direct) return direct;
  const norm = normalise(s);
  return norm && norm !== s ? parseDirect(norm) : null;
}
