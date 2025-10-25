// Compatibility layer for gradual ES6 migration
// This ensures window references work during transition

export function exposeToWindow(name, value) {
    if (typeof window !== 'undefined') {
        window[name] = value;
    }
}

export function getFromWindow(name) {
    if (typeof window !== 'undefined') {
        return window[name];
    }
    return undefined;
}

// Helper to make Fraction available globally
export function setupGlobalFraction(Fraction) {
    if (typeof window !== 'undefined') {
        window.Fraction = Fraction;
    }
}

// Helper to make tapspace available
export function getTapspace() {
    if (typeof window !== 'undefined' && window.tapspace) {
        return window.tapspace;
    }
    throw new Error('Tapspace library not loaded');
}