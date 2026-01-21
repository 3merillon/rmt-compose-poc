/**
 * HTML Escape Utility
 *
 * Provides functions to safely escape user-controlled content before
 * inserting into HTML contexts, preventing XSS attacks.
 */

/**
 * Escape HTML special characters to prevent XSS
 * @param {*} str - Value to escape (will be converted to string)
 * @returns {string} HTML-safe string
 */
export function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Escape a value for use in HTML attribute context
 * @param {*} str - Value to escape
 * @returns {string} Attribute-safe string
 */
export function escapeAttr(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Validates and sanitizes a CSS color value.
 * Accepts: hex (#fff, #ffffff, #ffffffff), rgb(), rgba(), hsl(), hsla(), named colors
 * @param {*} color - Color value to validate
 * @returns {string|null} Sanitized color or null if invalid
 */
export function validateColorInput(color) {
    if (typeof color !== 'string') return null;
    const trimmed = color.trim();
    if (!trimmed) return null;

    // Allow only safe color patterns
    const safePatterns = [
        /^#[0-9a-fA-F]{3}$/,                                           // #fff
        /^#[0-9a-fA-F]{6}$/,                                           // #ffffff
        /^#[0-9a-fA-F]{8}$/,                                           // #ffffffff (with alpha)
        /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/,         // rgb(255, 0, 0)
        /^rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*[\d.]+\s*\)$/,  // rgba(255, 0, 0, 0.5)
        /^hsl\(\s*\d{1,3}\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*\)$/,       // hsl(120, 100%, 50%)
        /^hsla\(\s*\d{1,3}\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+\s*\)$/, // hsla(120, 100%, 50%, 0.5)
    ];

    // Named colors whitelist (common CSS color names)
    const namedColors = new Set([
        'black', 'white', 'red', 'green', 'blue', 'yellow', 'cyan', 'magenta',
        'orange', 'purple', 'pink', 'brown', 'gray', 'grey', 'transparent',
        'navy', 'teal', 'olive', 'maroon', 'aqua', 'fuchsia', 'lime', 'silver',
        'aliceblue', 'antiquewhite', 'aquamarine', 'azure', 'beige', 'bisque',
        'blanchedalmond', 'blueviolet', 'burlywood', 'cadetblue', 'chartreuse',
        'chocolate', 'coral', 'cornflowerblue', 'cornsilk', 'crimson', 'darkblue',
        'darkcyan', 'darkgoldenrod', 'darkgray', 'darkgreen', 'darkgrey', 'darkkhaki',
        'darkmagenta', 'darkolivegreen', 'darkorange', 'darkorchid', 'darkred',
        'darksalmon', 'darkseagreen', 'darkslateblue', 'darkslategray', 'darkslategrey',
        'darkturquoise', 'darkviolet', 'deeppink', 'deepskyblue', 'dimgray', 'dimgrey',
        'dodgerblue', 'firebrick', 'floralwhite', 'forestgreen', 'gainsboro',
        'ghostwhite', 'gold', 'goldenrod', 'greenyellow', 'honeydew', 'hotpink',
        'indianred', 'indigo', 'ivory', 'khaki', 'lavender', 'lavenderblush',
        'lawngreen', 'lemonchiffon', 'lightblue', 'lightcoral', 'lightcyan',
        'lightgoldenrodyellow', 'lightgray', 'lightgreen', 'lightgrey', 'lightpink',
        'lightsalmon', 'lightseagreen', 'lightskyblue', 'lightslategray', 'lightslategrey',
        'lightsteelblue', 'lightyellow', 'limegreen', 'linen', 'mediumaquamarine',
        'mediumblue', 'mediumorchid', 'mediumpurple', 'mediumseagreen', 'mediumslateblue',
        'mediumspringgreen', 'mediumturquoise', 'mediumvioletred', 'midnightblue',
        'mintcream', 'mistyrose', 'moccasin', 'navajowhite', 'oldlace', 'olivedrab',
        'orangered', 'orchid', 'palegoldenrod', 'palegreen', 'paleturquoise',
        'palevioletred', 'papayawhip', 'peachpuff', 'peru', 'plum', 'powderblue',
        'rosybrown', 'royalblue', 'saddlebrown', 'salmon', 'sandybrown', 'seagreen',
        'seashell', 'sienna', 'skyblue', 'slateblue', 'slategray', 'slategrey',
        'snow', 'springgreen', 'steelblue', 'tan', 'thistle', 'tomato', 'turquoise',
        'violet', 'wheat', 'whitesmoke', 'yellowgreen'
    ]);

    if (namedColors.has(trimmed.toLowerCase())) return trimmed;
    if (safePatterns.some(p => p.test(trimmed))) return trimmed;

    return null; // Invalid color
}
