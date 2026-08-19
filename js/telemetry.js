// Telemetry: gameplay + error events, buffered locally. Call sites are wired
// throughout the app, but flags.telemetryEnabled keeps the buffer silent —
// flipping the flag turns collection on with no further code changes.
import { APP_VERSION } from './version.js';
import { flags } from './flags.js';

// Global, deliberately NOT user-namespaced: this is diagnostic data about
// the app on this device, not a user's game data.
const BUFFER_KEY = 'event_buffer';
const MAX_EVENTS = 500;

export function logEvent(name, payload = {}) {
  if (!flags.telemetryEnabled) return; // wired but off — no storage churn
  const event = {
    name,
    payload,
    ts: Date.now(),
    userId: null, // the demo build has no accounts
    appVersion: APP_VERSION,
  };
  // A full or blocked localStorage must never break gameplay — worst case
  // the event is dropped.
  try {
    let buffer;
    try {
      buffer = JSON.parse(localStorage.getItem(BUFFER_KEY)) || [];
    } catch {
      buffer = []; // corrupt buffer: start fresh rather than log nothing
    }
    if (!Array.isArray(buffer)) buffer = [];
    buffer.push(event);
    localStorage.setItem(BUFFER_KEY, JSON.stringify(buffer.slice(-MAX_EVENTS)));
  } catch { /* drop the event */ }
}

// No-op: this build has no server to send anything to.
export async function flush() {}
