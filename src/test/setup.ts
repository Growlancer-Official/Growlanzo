import '@testing-library/jest-dom';
import { vi } from 'vitest';

// jsdom never implemented scrollIntoView (every browser has it). Components
// call it when a list highlights an item (e.g. CountrySelect keyboard nav),
// so the effect would crash in tests without this stub.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// Node 22+ ships an experimental Web Storage global (`require('internal/
// webstorage')`) whose `localStorage` getter returns undefined unless the
// process was started with `--localstorage-file`. That getter lands on the
// jsdom window too, where it SHADOWS jsdom's real Storage instance — jsdom
// keeps it at `window._localStorage`. Result: `localStorage.clear()` in a test
// threw "Cannot read properties of undefined", and bare `localStorage` was
// undefined on globalThis as well.
//
// Restore jsdom's instance on both objects. `value` (not a getter) so a test
// can still redefine the global to simulate blocked/private-mode storage. This
// is environment repair, not a test change: the app's own code and assertions
// stay exactly as they were.
if (typeof window !== 'undefined') {
  const w = window as unknown as Record<string, unknown>;
  for (const key of ['localStorage', 'sessionStorage'] as const) {
    const internal = w[`_${key}`] as Storage | undefined;
    if (!internal) continue;
    Object.defineProperty(w, key, { configurable: true, writable: true, value: internal });
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: internal });
  }
}

// Silence console.error/warn in tests unless running in verbose mode
// — keeps test output clean while still catching real errors via assertions
if (!process.env.VITEST_VERBOSE) {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
}
