// Local leaderboard: per-device best times in one storage JSON blob.
// { playerName, levels: { "lesson1-level1": bestMs }, lessonTotals: { "lesson1": bestTotalMs },
//   runCleared: ["lesson1-level1", ...], furthestLesson: 1 }
// A slower run never overwrites a best and is never flagged — no fail states.
//
// Two lifecycles share this blob on purpose (one key, one round trip):
// - levels / lessonTotals are ALL-TIME bests — only a faster run or a new
//   player name ever changes them. NEVER derive playthrough state from
//   them: they survive "Play again", so they'd instantly re-check a fresh
//   island.
// - runCleared / furthestLesson are THIS playthrough's progress — they make
//   a page reload resume the run (map ⭐s + resume lesson) and are reset by
//   resetRun() on "Play again" or a new player name.
import { storage } from './storage.js';

const KEY = 'codequest.leaderboard';

async function load() {
  const raw = await storage.get(KEY); // corrupt blob reads as null
  if (raw && typeof raw === 'object') {
    return {
      playerName: raw.playerName || '',
      levels: raw.levels || {},
      lessonTotals: raw.lessonTotals || {},
      runCleared: Array.isArray(raw.runCleared) ? raw.runCleared : [],
      furthestLesson: raw.furthestLesson || 1,
    };
  }
  return { playerName: '', levels: {}, lessonTotals: {}, runCleared: [], furthestLesson: 1 };
}

async function save(board) {
  await storage.set(KEY, board);
}

export async function getPlayerName() {
  return (await load()).playerName;
}

// Device-level echo of the name, on raw localStorage next to the mute flags
// (NOT the namespaced facade): index.html's inline script reads it to prefill
// the start-screen input synchronously, before the modules load. The blob
// above stays authoritative — this is only ever a head start on painting.
const LAST_NAME_KEY = 'codequest.lastName';

export async function setPlayerName(name) {
  const board = await load();
  board.playerName = name;
  await save(board);
  try { localStorage.setItem(LAST_NAME_KEY, name); } catch { /* storage full/blocked */ }
}

// New player on this device (name changed at the start screen): best times
// belong to the kid who set them, so the board starts empty for the new kid
// — including the previous kid's in-progress run.
export async function clearTimes() {
  const board = await load();
  board.levels = {};
  board.lessonTotals = {};
  board.runCleared = [];
  board.furthestLesson = 1;
  await save(board);
}

// This playthrough's persisted progress: which levels are cleared (feeds the
// island map's ⭐s after a reload) and the lesson to resume at.
export async function getRunState() {
  const board = await load();
  return { runCleared: board.runCleared, furthestLesson: board.furthestLesson };
}

// "Play again": the island resets but best times stay all-time records —
// only the playthrough-scoped fields go back to their fresh-run values.
// Persisted immediately so a reload right after "Play again" still boots
// a fresh island.
export async function resetRun() {
  const board = await load();
  board.runCleared = [];
  board.furthestLesson = 1;
  await save(board);
}

// Records a completion. Returns true if this run set a new best for the level.
// lessonLevelIds is every level id in the lesson, in order — the lesson total
// only exists once all of them have a recorded time, and is always the sum of
// current bests (which can only shrink, so plain assignment keeps it a best).
export async function recordTime(levelId, lessonId, timeMs, lessonLevelIds) {
  const board = await load();
  const prev = board.levels[levelId];
  const isNewBest = prev === undefined || timeMs < prev;
  if (isNewBest) board.levels[levelId] = timeMs;
  if (lessonLevelIds.every((id) => board.levels[id] !== undefined)) {
    board.lessonTotals[lessonId] = lessonLevelIds.reduce(
      (sum, id) => sum + board.levels[id], 0
    );
  }
  // Run state rides the same write: the level is cleared in THIS run, and
  // once the whole lesson is cleared this run, the resume point moves past
  // it. max() so replaying an old lesson (map jump) never moves it backward.
  if (!board.runCleared.includes(levelId)) board.runCleared.push(levelId);
  if (lessonLevelIds.every((id) => board.runCleared.includes(id))) {
    const lessonNo = parseInt(lessonId.slice('lesson'.length), 10);
    if (Number.isFinite(lessonNo)) {
      board.furthestLesson = Math.max(board.furthestLesson, lessonNo + 1);
    }
  }
  await save(board);
  return isNewBest;
}

// Display list: one row per LEVEL (the thematic unit — player-facing name
// for what code/storage call a lesson), showing its best total time. A
// level's total only exists once every challenge in it has a recorded
// time, so rows appear as levels get fully completed. Only the last
// `count` are shown — short enough for a young reader. Per-challenge
// times stay in storage untouched; this only changes what's shown.
export async function getLevelEntries(lessons, count = 5) {
  const board = await load();
  const entries = [];
  for (const lesson of lessons) {
    const ms = board.lessonTotals[`lesson${lesson.lesson_id}`];
    if (ms !== undefined) {
      entries.push({ label: `Level ${lesson.lesson_id}`, ms });
    }
  }
  return { playerName: board.playerName, entries: entries.slice(-count) };
}


export function formatTime(ms) {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}
