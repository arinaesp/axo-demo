// Single source of truth for the app version. main.js paints it onto the
// splash screen at startup, so a stale cached JS copy is immediately
// visible ("v?" or an old number means the browser served old JS).
// Bump on every change handed over for manual testing.
export const APP_VERSION = '0.92';
export const BUILD_TIME = '2026-08-13';
