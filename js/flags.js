/**
 * Feature flags for the app.
 *
 * Hardcoded constants — this build has no server to fetch them from.
 */
export const flags = {
  telemetryEnabled: false, // wired but off; nothing is collected or sent
  showLeaderboard: true,
  // Console logging for the island-map open/close/jump lifecycle — flip to
  // true in DevTools sessions when chasing map navigation bugs (v0.71's
  // deadlock hunt); every map tap logs which layer handled it.
  debugMap: false,
};
