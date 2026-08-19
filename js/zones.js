// Zone/badge system data + pure logic (ZONE_SYSTEM_SPEC.md + the v0.77
// world-map redesign from zone-design.png). The zone is the PLACE (ocean
// depth, on brand with the axolotl); the badge is WHAT THE KID BECOMES.
// Zones never hard-gate progression — lessons are linear anyway; the map's
// locks and the completion ceremony are presentation.
//
// This module is deliberately pure (no DOM, no storage): a Node harness can
// assert the ceremony trigger and zone lookups without booting the app.
// (The spec sketched ZONE_DEFS living in main.js; it moved here for exactly
// that testability.)

// The demo ships lessons 1-2 only, so it has ONE zone covering exactly that
// range — the map then draws two live nodes and no unreachable dots. The full
// game splits its 40 lessons across four zones; everything below is written
// against zone.lessons, so the count is data, never hardcoded.
export const ZONE_DEFS = [
  {
    id: 'shallows',
    name: 'Start',
    emoji: '🟢',
    badge: 'Spark',
    badgeEmoji: '⚡',
    lessons: [1, 2],
  },
];

// How many lessons a zone covers — the map's dot count per island.
export const zoneLessonCount = (zone) => zone.lessons[1] - zone.lessons[0] + 1;

// Persisted badge key: the badge name lowercased — the spec's example blob is
// zones: ['spark', 'pilot']. Never derive from zone.id (shallows ≠ spark).
export const badgeId = (zone) => zone.badge.toLowerCase();

export function zoneOf(lessonId) {
  return ZONE_DEFS.find(
    (z) => lessonId >= z.lessons[0] && lessonId <= z.lessons[1]
  ) || null;
}

// A zone counts as cleared THIS PLAYTHROUGH only when every lesson in its
// range is actually loaded AND fully cleared — a partially-shipped zone
// (e.g. lessons 11-14 built, 15-20 not yet) can never read as cleared.
function zoneCleared(zone, lessonIds, clearedLessonIds) {
  for (let id = zone.lessons[0]; id <= zone.lessons[1]; id++) {
    if (!lessonIds.includes(id) || !clearedLessonIds.has(id)) return false;
  }
  return true;
}

// The zone whose LAST lesson is lessonId, but only if the whole zone is
// cleared this playthrough — the ceremony's trigger condition. Returns null
// otherwise (not a zone end, zone not fully cleared, zone not fully shipped).
export function zoneJustCompleted(lessonId, lessonIds, clearedLessonIds) {
  const zone = ZONE_DEFS.find((z) => z.lessons[1] === lessonId);
  if (!zone) return null;
  return zoneCleared(zone, lessonIds, clearedLessonIds) ? zone : null;
}

// Which zones the kid has reached this playthrough: a zone opens the moment
// the current lesson enters its range. With everything loaded cleared there
// is no "now" lesson, so the position is one past the last loaded lesson —
// that opens the next zone's island right after its predecessor is finished
// ("Move to Next Zone" then shows it visibly unlocked). Earlier zones stay
// open forever within a playthrough; "Play again" resets to zone 1 only.
export function effectiveNow(nowLessonId, lessonIds) {
  const last = lessonIds[lessonIds.length - 1] || 0;
  return nowLessonId != null ? nowLessonId : last + 1;
}

export const zoneReachable = (zone, effNow) => effNow >= zone.lessons[0];
