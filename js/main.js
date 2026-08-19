// Lesson flow: splash → learn each command → play each level → complete.
// Lesson content comes entirely from data/lesson1.json (the data layer).
import { storage } from './storage.js';
import { flags } from './flags.js';
import { logEvent } from './telemetry.js';
import { APP_VERSION } from './version.js';
import { AudioManager } from './audio.js';
import { setPlayerEmoji } from './grid.js';
import { runLearnPhase, refreshLearnGloss } from './learn.js';
import { runPlayPhase, pauseRun, resumeRun, abortRun, refocusRun } from './play.js';
import {
  ZONE_DEFS, badgeId, zoneJustCompleted, effectiveNow, zoneReachable,
  zoneLessonCount,
} from './zones.js';
// Player-facing terminology: a LEVEL is the thematic unit (code and storage
// still call it "lesson" internally — renaming ids would orphan saved best
// times), and a CHALLENGE is one grid puzzle inside a level, numbered
// continuously across the whole game.
import {
  getPlayerName, setPlayerName, clearTimes, recordTime,
  getLevelEntries, formatTime, getRunState, resetRun,
} from './leaderboard.js';

// The demo build has no sign-in: it boots straight into the game. (The full
// app gates here on a verified session before any game code runs.)
// Top-level await: the module pauses here until first-run storage is ready.
await storage.getSchemaVersion(); // triggers first-run init
logEvent('app_boot');
// Global error capture — wired before the UI boots, so even a failure inside
// init() lands in the event buffer.
window.addEventListener('error', (e) => {
  logEvent('js_error', {
    message: e.message, source: e.filename, line: e.lineno, col: e.colno,
  });
});
window.addEventListener('unhandledrejection', (e) => {
  logEvent('unhandled_rejection', { reason: String(e.reason) });
});

// Caption language comes from the stored 'axo_lang' choice, else English —
// see js/i18n.js. The 🌍 picker sets it.

const ANIMAL_KEY = 'codequest.animal';

// What finishing a lesson (every level cleared this playthrough) earns: a
// new playable animal, revealed by the chest ceremony. Unlocks persist
// across replays — earned once, kept forever.
const REWARDS = {
  3: { animal: { emoji: '🐱', label: 'Cat' } },
  4: { animal: { emoji: '🐲', label: 'Dragon' } },
  5: { animal: { emoji: '🦁', label: 'Lion' } }, // face glyph (doc's owl is full-body)
  6: { animal: { emoji: '🐼', label: 'Panda' } },
  7: { animal: { emoji: '🐯', label: 'Tiger' } },
  8: { animal: { emoji: '🦄', label: 'Unicorn' } },
  // Face-glyph rule: the doc's chameleon 🦎 is full-body and phoenix 🔥
  // isn't an animal face — frog (big scanning eyes) and monkey stand in.
  9: { animal: { emoji: '🐸', label: 'Frog' } },
  10: { animal: { emoji: '🐵', label: 'Monkey' } },
};

// Roster changes: fox → beaver → hamster (fox read sad; beaver was a
// full-body glyph while the rest are faces — hamster is the face-style
// rodent), penguin → dragon. Maps saved choices/unlocks from any older
// roster to the current animals.
const EMOJI_SWAP = { '🦊': '🐹', '🦫': '🐹', '🐧': '🐲' };

// Persistent unlock state: { animals: [emoji], zones: [badgeId] }. Separate
// from the leaderboard blob — different lifecycle (rewards are never reset
// by anything). zones holds earned zone badges ('spark', 'pilot', …) — same
// earned-once-kept-forever life as animals. Older blobs may carry cosmetics
// keys from the removed cosmetic system; they're simply ignored and dropped
// on the next save.
const UNLOCKS_KEY = 'codequest.unlocks';
async function loadUnlocks() {
  const raw = await storage.get(UNLOCKS_KEY); // corrupt blob reads as null
  if (raw && typeof raw === 'object') {
    return {
      animals: (raw.animals || []).map((a) => EMOJI_SWAP[a] || a),
      zones: raw.zones || [], // pre-v0.76 blobs simply have none yet
    };
  }
  return { animals: [], zones: [] };
}
const unlocks = await loadUnlocks();
async function saveUnlocks() {
  await storage.set(UNLOCKS_KEY, unlocks);
}

const $ = (id) => document.getElementById(id);

const screens = {
  start: $('screen-start'),
  animal: $('screen-animal'),
  map: $('screen-map'),
  learn: $('screen-learn'),
  play: $('screen-play'),
  complete: $('screen-complete'),
  reward: $('screen-reward'),
  badge: $('screen-badge'),
  leaderboard: $('screen-leaderboard'),
};

// Tracked so detour screens (map, leaderboard) can return to exactly the
// screen the kid left.
let currentScreen = 'start';
function showScreen(name) {
  currentScreen = name;
  for (const [key, el] of Object.entries(screens)) el.hidden = key !== name;
}

const progressEl = $('progress');
const progressDots = $('progress-dots');
function setProgress(step, total) {
  progressEl.hidden = false;
  progressDots.innerHTML = '';
  for (let i = 0; i < total; i++) {
    const dot = document.createElement('span');
    dot.className = 'dot' + (i < step ? ' dot-done' : i === step ? ' dot-now' : '');
    progressDots.appendChild(dot);
  }
}

const toastEl = $('toast');
let toastTimer;
function showToast(text) {
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2200);
}

const learnEls = {
  word: $('learn-word'),
  gloss: $('gloss'),
  sayBtn: $('btn-say-word'),
  slots: $('letter-slots'),
  bank: $('letter-bank'),
  squish: $('squish-area'),
  demoArea: $('demo-area'),
  demoGrid: $('demo-grid'),
  demoPouch: $('demo-pouch'), // 🪙 counter beside the collect card's strip
  replayBtn: $('btn-replay-demo'),
  nextBtn: $('btn-learn-next'),
  backBtn: $('btn-learn-back'),
  skipBtn: $('btn-learn-skip'),
};

const playEls = {
  grid: $('play-grid'),
  coinCounter: $('coin-counter'),
  coinPart: $('coin-part'),
  coinCount: $('coin-count'),
  gemPart: $('gem-part'),
  gemCount: $('gem-count'),
  keyPart: $('key-part'),
  keyCount: $('key-count'),
  sequence: $('sequence'),
  form: $('cmd-form'),
  input: $('cmd-input'),
  addBtn: $('btn-add'),
  hints: $('word-hints'),
  runBtn: $('btn-run'),
  clearBtn: $('btn-clear'),
  backBtn: $('btn-play-back'),
  skipBtn: $('btn-play-skip'),
};

// Levels cleared in THIS playthrough — the island map fills from here.
// Persisted as the leaderboard blob's runCleared list (restored in init()),
// so a page reload resumes the run instead of resetting it; only "Play
// again" or a new player name empties it (memory AND storage together).
// Best times live separately in the same blob and are all-time.
const playthroughCleared = new Set();

// Island-map jumps: tapping a done marker (or the pulsing "now" marker for a
// lesson other than the one on screen) unwinds the active lesson flow and
// restarts runGame's loop at the tapped lesson's first Learn card. Every
// step await inside a playthrough races against the pending jump signal via
// stepOrJump; the JUMP sentinel propagates up to runGame's lesson cursor.
// Saved progress is untouched: playthroughCleared keeps its checkmarks and
// recordTime still only overwrites a best when the replay was faster.
const JUMP = Symbol('jump');
let jumpTargetId = null; // lesson_id requested by the tapped marker
let signalJump = null; // armed while a playthrough step is awaiting; else null
let activeLessonId = null; // lesson currently on screen (null between games)
// Map-lifecycle debug logging — silent unless flags.debugMap is flipped in a
// DevTools session. Shows which layer went quiet when a map tap does nothing.
const mapDbg = (...args) => { if (flags.debugMap) console.log('[map]', ...args); };
function stepOrJump(promise) {
  let mine;
  const race = Promise.race([
    promise,
    new Promise((res) => {
      mine = (lessonId) => { jumpTargetId = lessonId; res(JUMP); };
      signalJump = mine;
    }),
  ]);
  // The step settled (normally or via jump): STOP LISTENING. Before v0.71,
  // signalJump kept pointing at the settled race's resolver — a marker tap
  // during a non-raced await (the reward chest, recordTime) passed peekMap's
  // signalJump check, "dispatched" into the dead promise, and peekMap
  // returned without ever closing the map: an inert map wedged on screen.
  // Identity-guarded so this cleanup can never clear a NEWER step's listener.
  return race.finally(() => { if (signalJump === mine) signalJump = null; });
}

// The lesson as a tape of steps (word cards, then levels) with a cursor.
// Back moves one step left, Skip one step right, completing a step moves
// right — Skip never jumps further than the next logical step. Returns the
// final level's { timeMs, isNewBest } for the lesson-complete screen, or
// null if the final level was skipped.
async function runLesson(lesson, audio, priorVocab = [], chipWords = null) {
  logEvent('lesson_start', { lesson: lesson.lesson_id });
  activeLessonId = lesson.lesson_id; // the map's "now" tap on THIS lesson just closes
  const peekBtn = $('btn-map-peek');
  peekBtn.hidden = false;

  // Levels accept this lesson's new words plus priorVocab — every word
  // taught in earlier lessons (cumulative vocabulary, per the design doc:
  // commands carry forward forever, so go(2)/go(3) chips appear in lesson 4
  // and beyond without re-declaring them). Deduped by word: the go(N) watch
  // and practice cards teach the same word twice, but it should appear as
  // ONE reference chip in the play phase.
  // no_chip cards (e.g. the repeat+end recap) are learn-only: never a
  // reference chip, never an input mapping.
  const seenWords = new Set();
  const playCommands = [...lesson.commands, ...priorVocab]
    .filter((c) => !c.no_chip && !seenWords.has(c.word) && seenWords.add(c.word));
  const levelIds = lesson.levels.map((_, i) => `lesson${lesson.lesson_id}-level${i + 1}`);
  const steps = [
    ...lesson.commands.map((command) => ({ type: 'learn', command })),
    ...lesson.levels.map((level, index) => ({ type: 'play', level, index })),
  ];
  const total = steps.length;

  // Lesson-wide coin tally for the on-grid counter: each completed level
  // banks its coins (keyed by level, so replaying one overwrites rather
  // than double-counts). Resets naturally with each new lesson.
  const coinBank = new Map(); // levelId -> { coin, gem } piece counts
  const lessonHasCoins = lesson.levels.some((l) => (l.items || []).length > 0);
  const lessonHasGems = lesson.levels.some((l) =>
    (l.items || []).some((it) => it.type === 'gem'));

  let lessonResult = null;
  let cursor = 0;
  while (cursor < total) {
    const step = steps[cursor];
    const canGoBack = cursor > 0;
    setProgress(cursor, total);

    if (step.type === 'learn') {
      showScreen('learn');
      const r = await stepOrJump(runLearnPhase(learnEls, step.command, audio, canGoBack));
      if (r === JUMP) return JUMP;
      if (r === 'back') logEvent('back_pressed', { screen: 'learn', lesson: lesson.lesson_id });
      if (r === 'skip') logEvent('skip_pressed', { screen: 'learn', lesson: lesson.lesson_id });
      cursor += r === 'back' ? -1 : 1;
      continue;
    }

    showScreen('play');
    // Every appearance of the challenge grid counts as a start — including
    // re-entry via Back or after a completed replay.
    logEvent('level_start', { lesson: lesson.lesson_id, level: step.index + 1 });
    const id = levelIds[step.index];
    // The counter starts from what OTHER levels banked — replaying this
    // level re-collects its own coins, so its old contribution sits out.
    const banked = [...coinBank].reduce(
      (sum, [lid, v]) => lid === id
        ? sum
        : { coin: sum.coin + v.coin, gem: sum.gem + v.gem },
      { coin: 0, gem: 0 }
    );
    const r = await stepOrJump(runPlayPhase(
      playEls, step.level, playCommands, audio, showToast, canGoBack,
      { banked, show: lessonHasCoins, gems: lessonHasGems }, chipWords
    ));
    if (r === JUMP) return JUMP;
    if (r.outcome === 'back') {
      logEvent('back_pressed', { screen: 'play', lesson: lesson.lesson_id, level: step.index + 1 });
      cursor--;
      continue;
    }

    const isLastStep = cursor === total - 1;
    if (r.outcome === 'skip') {
      logEvent('skip_pressed', { screen: 'play', lesson: lesson.lesson_id, level: step.index + 1 });
      cursor++;
      continue;
    }

    // Completed. A replayed level keeps its checkmark; recordTime only
    // overwrites the stored best when this run was faster.
    const isNewBest = await recordTime(id, `lesson${lesson.lesson_id}`, r.timeMs, levelIds);
    playthroughCleared.add(id);
    coinBank.set(id, r.coins
      ? { coin: r.coins.coin, gem: r.coins.gem }
      : { coin: 0, gem: 0 });

    // Stars rate command efficiency against the level's optimal program
    // length — a gentle nudge, never a gate: finishing is always ≥ 1 star.
    const optimal = step.level.optimal_lines
      || (step.level.required_sequence || []).length || r.lines;
    const stars = r.lines <= optimal ? 3
      : r.lines <= Math.ceil(optimal * 1.5) ? 2 : 1;
    logEvent('level_complete', {
      lesson: lesson.lesson_id, level: step.index + 1,
      timeMs: r.timeMs, commandCount: r.lines, stars,
    });
    const result = { timeMs: r.timeMs, isNewBest, stars, lines: r.lines, coins: r.coins };

    // Challenge numbers run continuously across the whole game (level 2
    // starts at challenge 3, never a second "Challenge 1").
    const c = await stepOrJump(showComplete(
      `Challenge ${lesson.level_offset + step.index + 1} complete!`,
      isLastStep ? 'Finish level ▶' : 'Next challenge ▶',
      result, true
    ));
    if (c === JUMP) return JUMP;
    if (c === 'back') {
      // Complete-screen Back replays the level just finished.
      logEvent('back_pressed', { screen: 'complete', lesson: lesson.lesson_id, level: step.index + 1 });
      continue; // cursor stays put
    }
    if (isLastStep) {
      // The lesson-complete card repeats only the neutral facts — the last
      // level's stars would read as the whole lesson's rating there.
      lessonResult = { timeMs: r.timeMs, isNewBest };
    }
    cursor++;
  }

  setProgress(total, total);
  peekBtn.hidden = true;
  return lessonResult;
}

// One screen for both level- and lesson-complete. The run's time is always
// shown neutrally; the best badge appears only on a new best — a slower run
// is simply not mentioned. result may be null (final level skipped): no
// time, no badge, just the screen. canBack shows a Back that replays the
// level just finished; resolves 'next' or 'back'.
function showComplete(title, btnLabel, result, canBack = false) {
  return new Promise((resolve) => {
    $('complete-title').textContent = title;
    const timeEl = $('complete-time');
    timeEl.hidden = !result;
    if (result) timeEl.textContent = `⏱ ${formatTime(result.timeMs)}`;
    $('complete-best').hidden = !result || !result.isNewBest;
    // Level results carry stars + program stats; the lesson card doesn't.
    // Only earned stars are shown — no hollow "missing star" slots.
    const starsEl = $('complete-stars');
    starsEl.hidden = !result?.stars;
    if (result?.stars) starsEl.textContent = '⭐'.repeat(result.stars);
    const statsEl = $('complete-stats');
    const stats = [];
    if (result?.lines) {
      stats.push(`📝 ${result.lines} ${result.lines === 1 ? 'command' : 'commands'}`);
    }
    // Coins and gems split into their own X/Y readouts; each appears only
    // when the level actually contains that item type.
    if (result?.coins?.coinTotal) {
      stats.push(`🪙 ${result.coins.coin}/${result.coins.coinTotal}`);
    }
    if (result?.coins?.gemTotal) {
      stats.push(`💎 ${result.coins.gem}/${result.coins.gemTotal}`);
    }
    statsEl.hidden = stats.length === 0;
    statsEl.textContent = stats.join('  ·  ');
    const backBtn = $('btn-complete-back');
    backBtn.hidden = !canBack;
    backBtn.onclick = () => resolve('back');
    const btn = $('btn-again');
    btn.textContent = btnLabel;
    btn.onclick = () => resolve('next');
    showScreen('complete');
  });
}

// One row per fully-completed level (best total time), last five shown —
// short enough for a young reader. Per-challenge history stays in
// localStorage; this only changes what's shown.
async function renderLeaderboard(lessons) {
  const { playerName, entries } = await getLevelEntries(lessons);
  $('lb-lesson').textContent = 'Your levels';
  $('lb-player').textContent = playerName ? `⭐ ${playerName}` : '';
  const list = $('lb-list');
  list.innerHTML = '';
  for (const entry of entries) {
    const row = document.createElement('li');
    row.className = 'lb-row';
    const label = document.createElement('span');
    label.textContent = entry.label;
    const time = document.createElement('span');
    time.className = 'lb-time';
    time.textContent = formatTime(entry.ms);
    row.append(label, time);
    list.appendChild(row);
  }
}

// World map (since v0.77, zone-design.png direction): a FIXED 2×2 grid of
// four rounded-square island zones — the whole 40-lesson journey on one
// screen, no scrolling anywhere. Reading order runs like text: across the
// TOP row L→R, then the BOTTOM row L→R (Shallows TL → Twilight TR → Abyss
// BL → Atlantis BR), the lesson numbers flowing 1-10 → 11-20 → 21-30 →
// 31-40 — the 10→11 hand-off across islands carries the journey, no drawn
// line needed. Each island carries its own serpentine
// road of 10 numbered nodes; a zone the kid hasn't reached this playthrough
// is covered by a big friendly brass 🔒 and none of its dots respond to
// touch. Node states inside an open zone: done (✓ with a ✨ spark), now
// (pulsing white glow), upcoming (clean numbered dots — visually bright but
// INERT, per the core rule that locked markers never respond; the zone-level
// lock is the only padlock on the map). Reads this playthrough's progress,
// not all-time history — a replay starts fresh. Done and now nodes are real
// <button>s (44px hit area around a 30px dot) calling onPick(lesson_id, state).
const ISLE_GRID = { // zone id → [gridRow, gridColumn] in the 2×2 world
  shallows: [1, 1], twilight: [1, 2], abyss: [2, 1], atlantis: [2, 2],
};
// Serpentine road waypoints, in % of an island's road box: node k of every
// zone sits at ISLE_NODE_POS[k]; the dotted road runs through them in order.
const ISLE_NODE_POS = [
  [14, 12], [40, 5], [66, 10], [85, 26],
  [66, 40], [38, 38], [14, 52],
  [24, 76], [52, 84], [81, 74],
];

// The waypoint table above is drawn for a ten-lesson zone. A shorter zone
// samples it evenly end-to-end, so its nodes still run start→finish down the
// island instead of bunching in the top corner. Ten returns the table itself.
function isleNodePositions(count) {
  if (count >= ISLE_NODE_POS.length) return ISLE_NODE_POS.slice(0, count);
  if (count === 1) return [ISLE_NODE_POS[0]];
  const last = ISLE_NODE_POS.length - 1;
  return Array.from({ length: count }, (_, k) =>
    ISLE_NODE_POS[Math.round((k * last) / (count - 1))]);
}

// Smooth dotted path through px points: quadratic curves through segment
// midpoints — gentle serpentine bends, no hand-tuned control points.
function roadPathD(pts) {
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i];
    const [nx, ny] = pts[i + 1];
    d += ` Q ${x} ${y}, ${(x + nx) / 2} ${(y + ny) / 2}`;
  }
  const [lx, ly] = pts[pts.length - 1];
  d += ` L ${lx} ${ly}`;
  return d;
}

function dottedSvg(w, h, d, cls) {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  svg.appendChild(path);
  return svg;
}

// One lesson's "fully cleared this playthrough" check — shared by the map
// markers, the island locks, and the zone-badge trigger.
const isLessonCleared = (lesson) => lesson.levels.every((_, i) =>
  playthroughCleared.has(`lesson${lesson.lesson_id}-level${i + 1}`));

// A zone divider bar (also reused by the ceremony's unlock teaser, hence the
// optional gridRow): completed shows the earned badge instead of the zone
// identity, active shows full color, locked is dimmed with a 🔒 appended.
// Always an inert div — dividers are decorative, never a gate or a button.
function makeZoneDivider(zone, state, gridRow = null) {
  const bar = document.createElement('div');
  bar.className = `zone-divider zone-${zone.id} zone-${state}`;
  if (gridRow != null) bar.style.gridRow = String(gridRow);
  const emoji = document.createElement('span');
  emoji.className = 'zone-emoji';
  const name = document.createElement('span');
  name.className = 'zone-name';
  if (state === 'completed') {
    emoji.textContent = zone.badgeEmoji;
    name.textContent = zone.badge.toUpperCase();
  } else {
    emoji.textContent = zone.emoji;
    name.textContent = zone.name.toUpperCase();
  }
  bar.append(emoji, name);
  if (state === 'locked') {
    const lock = document.createElement('span');
    lock.className = 'zone-lock';
    lock.textContent = '🔒';
    bar.appendChild(lock);
  }
  return bar;
}

function renderMap(lessons, onPick) {
  const world = $('island-map');
  world.innerHTML = '';

  // Pass 1: per-lesson playthrough state — the markers, the island locks,
  // and the banner all read this one source, so they can never disagree
  // after a replay or jump.
  const lessonState = new Map(); // lesson_id -> done | now | locked
  let nowLessonId = null;
  for (const lesson of lessons) {
    if (isLessonCleared(lesson)) {
      lessonState.set(lesson.lesson_id, 'done');
    } else if (nowLessonId === null) {
      nowLessonId = lesson.lesson_id;
      lessonState.set(lesson.lesson_id, 'now');
    } else {
      lessonState.set(lesson.lesson_id, 'locked');
    }
  }
  const effNow = effectiveNow(nowLessonId, lessons.map((l) => l.lesson_id));

  const byId = new Map(lessons.map((l) => [l.lesson_id, l]));
  const isles = []; // in ZONE_DEFS order — the courier line walks this
  for (const zone of ZONE_DEFS) {
    const open = zoneReachable(zone, effNow);
    const earned = unlocks.zones.includes(badgeId(zone));
    const isle = document.createElement('div');
    isle.className =
      `zone-isle isle-${zone.id} ${open ? 'isle-open' : 'isle-shut'}`;
    const [row, col] = ISLE_GRID[zone.id];
    isle.style.gridRow = String(row);
    isle.style.gridColumn = String(col);

    // Name pill (top-left) + badge chip (top-right). The badge is always
    // visible — labeled per the design — and lights up once earned.
    const name = document.createElement('div');
    name.className = 'isle-name';
    name.textContent = `${zone.emoji} ${zone.name}`;
    const badge = document.createElement('div');
    badge.className = 'isle-badge' + (earned ? ' badge-earned' : '');
    badge.textContent = `${zone.badgeEmoji} ${zone.badge}`;

    const road = document.createElement('div');
    road.className = 'isle-road';
    const nodePos = isleNodePositions(zoneLessonCount(zone));
    for (let k = 0; k < nodePos.length; k++) {
      const id = zone.lessons[0] + k;
      const lesson = byId.get(id);
      // Unloaded lessons (a part-shipped zone) and shut zones render the
      // same clean numbered dots — always inert.
      const state = open && lesson ? lessonState.get(id) : 'locked';
      const tappable = state === 'done' || state === 'now';
      const node = document.createElement(tappable ? 'button' : 'div');
      node.className = 'isle-node ' + (state === 'done' ? 'node-done'
        : state === 'now' ? 'node-now' : 'node-todo');
      const [x, y] = nodePos[k];
      node.style.left = `${x}%`;
      node.style.top = `${y}%`;
      const dot = document.createElement('span');
      dot.className = 'isle-dot';
      dot.textContent = state === 'done' ? '✓' : String(id);
      node.appendChild(dot);
      if (tappable) {
        node.type = 'button';
        node.setAttribute('aria-label', state === 'done'
          ? `Replay Level ${id}`
          : `Continue Level ${id}`);
        node.onclick = () => onPick(id, state);
      }
      road.appendChild(node);
    }

    isle.append(name, badge, road);
    if (!open) {
      // The big friendly brass lock covering the road (CSS filters turn the
      // emoji brass). The island stays visible underneath — "something to
      // look forward to", same principle as the animal picker.
      const lock = document.createElement('div');
      lock.className = 'isle-lock';
      lock.textContent = '🔒';
      isle.appendChild(lock);
    }
    world.appendChild(isle);
    isles.push({ isle, road, nodePos });
  }

  // Each island's own serpentine road, measured from live layout (callers
  // show the map screen before rendering, so geometry is real).
  for (const { road, nodePos } of isles) {
    const w = road.clientWidth;
    const h = road.clientHeight;
    const pts = nodePos.map(([x, y]) => [(x / 100) * w, (y / 100) * h]);
    road.prepend(dottedSvg(w, h, roadPathD(pts), 'isle-road-path'));
  }
  // Banner above the Go button: motivational copy pointing at the next
  // still-locked zone; hidden once every zone is open. Presentation only —
  // progression gates itself (lessons are linear), the map never does.
  const nextShut = ZONE_DEFS.find((z) => !zoneReachable(z, effNow));
  const banner = $('map-banner');
  banner.hidden = !nextShut;
  if (nextShut) {
    const n = ZONE_DEFS.indexOf(nextShut) + 1;
    banner.textContent = `Unlock Zone ${n} by finishing Zone ${n - 1}!`;
  }
}

// welcome: true shows the one-time greeting, a "Let's go!" button and a Back
// to re-pick the animal; otherwise it's the map with Back only. Resolves
// 'go', 'back', or { jump: lesson_id } when a done/now marker is tapped and
// the kid should be dropped into that lesson's first Learn card.
// fallbackTo (peek maps only) arms a Back-tap watchdog: if the tap didn't
// leave the map screen within 500ms — the lesson loop never responded, i.e.
// this map's promise was already settled/orphaned — force-close to that
// screen directly and log map_deadlock_recovered. Belt-and-braces on top of
// the v0.71 lifecycle fixes; in a healthy session it never fires.
let mapSession = 0; // which openMap call currently owns the map screen
async function openMap(lessons, { welcome, fallbackTo = null, goLabel = null }) {
  // Storage reads happen up front so the Promise executor below stays sync.
  const name = welcome ? await getPlayerName() : '';
  const welcomeAnimal = welcome ? (await storage.get(ANIMAL_KEY)) || '🐻' : '';
  return new Promise((resolve) => {
    const session = ++mapSession;
    const backBtn = $('btn-map-back');
    backBtn.hidden = !welcome;
    backBtn.onclick = () => resolve('back');
    const greet = $('map-greeting');
    greet.hidden = !welcome;
    if (welcome) {
      // One greeting picked at random — kept short, at most one comma.
      const greetings = [
        `Welcome, ${name}! 🌟`,
        `Hey SuperCoder ${name}!`,
        `Let's play, ${name}! 🚀`,
      ];
      $('welcome-animal').textContent = welcomeAnimal;
      $('welcome-title').textContent =
        greetings[Math.floor(Math.random() * greetings.length)];
    }
    const btn = $('btn-map-go');
    // goLabel override: the post-ceremony "Move to Next Zone" map is a
    // forward move, so its button reads "Let's go!" even without welcome.
    btn.textContent = goLabel || (welcome ? "Let's go! ▶" : '⬅ Back');
    btn.onclick = () => {
      mapDbg('back tapped', { session, welcome });
      resolve('go');
      if (welcome || !fallbackTo) return;
      // Watchdog: a healthy close happens in microtasks — 500ms of still
      // sitting on the map means resolve() hit an already-settled promise
      // and nothing upstream is listening. Force-close so the kid is never
      // stranded. Session check: if a NEWER openMap owns the screen by then
      // (kid closed and reopened within 500ms), leave it alone.
      setTimeout(() => {
        if (currentScreen !== 'map' || mapSession !== session) return;
        logEvent('map_deadlock_recovered', { position: fallbackTo });
        mapDbg('DEADLOCK fallback fired — force-closing map', { fallbackTo });
        resumeRun();
        showScreen(fallbackTo);
        if (fallbackTo === 'play') refocusRun();
      }, 500);
    };
    // Screen first, then render: the island roads and the courier line are
    // drawn from measured positions, which hidden elements don't have.
    showScreen('map');
    renderMap(lessons, (lessonId, state) => {
      mapDbg('marker tapped', {
        session, lessonId, state, jumpArmed: Boolean(signalJump),
      });
      // The now marker "resumes where you are": on the welcome map that's
      // exactly what "Let's go!" does (a restored run resumes at its saved
      // lesson), and mid-run it just closes the map for the lesson already
      // on screen. Anything else — including a restored ⭐ on the welcome
      // map after a reload — jumps into that lesson's first Learn card.
      if (state === 'now' && (welcome || lessonId === activeLessonId)) {
        resolve('go');
        return;
      }
      resolve({ jump: lessonId });
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Brief confetti burst over the game column — celebratory, gone in ~2.5s.
// Anchored inside #app so it stays with the game on wide screens.
function spawnConfetti(count = 18) {
  const host = document.createElement('div');
  host.className = 'confetti';
  const pieces = ['🎉', '✨', '⭐', '🎊'];
  for (let i = 0; i < count; i++) {
    const p = document.createElement('span');
    p.className = 'confetti-piece';
    p.textContent = pieces[i % pieces.length];
    p.style.left = `${5 + Math.random() * 90}%`;
    p.style.animationDuration = `${1.3 + Math.random() * 0.9}s`;
    p.style.animationDelay = `${Math.random() * 0.4}s`;
    host.appendChild(p);
  }
  $('app').appendChild(host);
  setTimeout(() => host.remove(), 2800);
}

// Reward chest ceremony: confetti + chest bouncing IN as the screen appears,
// tap to open (pop-and-burst animation), then the big new-friend reveal.
function showReward(reward) {
  return new Promise((resolve) => {
    const chest = $('reward-chest');
    const hint = $('reward-hint');
    const reveal = $('reward-reveal');
    chest.hidden = false;
    chest.classList.remove('opening');
    hint.hidden = false;
    reveal.hidden = true;
    chest.onclick = async () => {
      chest.onclick = null; // one open per chest
      chest.classList.add('opening'); // pop-wiggle-burst, then gone
      await sleep(450);
      chest.hidden = true;
      hint.hidden = true;
      $('reward-animal-emoji').textContent = reward.animal.emoji;
      $('reward-animal').textContent = `New friend unlocked: ${reward.animal.label}!`;
      reveal.hidden = false;
      spawnConfetti(14); // second, smaller burst for the reveal itself
    };
    $('btn-reward-continue').onclick = () => resolve();
    showScreen('reward');
    spawnConfetti();
  });
}

// Zone-completion ceremony (~8-10s, ZONE_SYSTEM_SPEC.md + the v0.77
// world-map flow): a 4s full-screen badge reveal on the zone's theme
// background, then the next zone's unlock teaser (its bar replica: 🔒
// shatters, name wakes to full color) offering the two-way choice —
// resolves 'again' (🔄 Play Again: replay the zone's last lesson) or 'map'
// (🗺 Move to Next Zone: back to the world map, where the next island now
// renders unlocked). After the FINAL zone instead: the all-friends parade,
// resolving 'done' on Play again 🔁.
function showBadgeCeremony(zone, nextZone) {
  return new Promise((resolve) => {
    const screenEl = screens.badge;
    // Theme class colors the whole screen (warm gold / deep blue / dark
    // purple-black / sunken gold). hidden is an attribute — untouched here.
    screenEl.className = `screen badge-theme-${zone.id}`;
    $('badge-emoji').textContent = zone.badgeEmoji;
    $('badge-title').textContent =
      `You're a ${zone.badge.toUpperCase()} now! ${zone.badgeEmoji}`;
    const count = zone.lessons[1] - zone.lessons[0] + 1;
    $('badge-subtitle').textContent =
      `${zone.name} complete — ${count} levels conquered!`;
    const teaser = $('badge-teaser');
    const finale = $('badge-finale');
    teaser.hidden = true;
    finale.hidden = true;
    showScreen('badge');
    spawnConfetti(36); // 2× the normal burst — the biggest moment in 10 lessons
    (async () => {
      await sleep(4000); // the badge alone holds the screen first (spec: ~4s)
      if (nextZone) {
        // Unlock teaser: the same divider the map renders, starting locked.
        const bar = makeZoneDivider(nextZone, 'locked');
        const holder = $('badge-teaser-bar');
        holder.innerHTML = '';
        holder.appendChild(bar);
        $('badge-teaser-text').textContent = `${nextZone.name} awaits…`;
        teaser.hidden = false;
        await sleep(600); // let the bar land before the lock breaks
        bar.querySelector('.zone-lock')?.classList.add('lock-shatter');
        bar.classList.add('zone-waking'); // dimmed→full color transition
        $('btn-badge-replay').onclick = () => resolve('again');
        $('btn-badge-map').onclick = () => resolve('map');
      } else {
        // Final zone: every friend the kid unlocked walks across the screen.
        const parade = $('badge-parade');
        parade.innerHTML = '';
        const starters = ['🐻', '🐹', '🐰'];
        [...starters, ...unlocks.animals].forEach((animal, i) => {
          const walker = document.createElement('span');
          walker.className = 'parade-animal';
          walker.textContent = animal;
          walker.style.animationDelay = `${i * 0.45}s`;
          parade.appendChild(walker);
        });
        finale.hidden = false;
        $('btn-badge-again').onclick = () => resolve('done');
      }
    })();
  });
}

// Grants the zone badge the first time the zone's LAST lesson lands with
// every lesson of the zone fully cleared this playthrough, then plays the
// ceremony. Idempotent like maybeReward: an earned badge never replays it —
// the map divider just shows the badge quietly. A partially-shipped zone
// (11-14 without 15-20) can never trigger (zoneJustCompleted checks the full
// range is loaded).
async function maybeZoneCeremony(lessons, lesson) {
  const cleared = new Set(
    lessons.filter(isLessonCleared).map((l) => l.lesson_id)
  );
  const zone = zoneJustCompleted(
    lesson.lesson_id, lessons.map((l) => l.lesson_id), cleared
  );
  if (!zone || unlocks.zones.includes(badgeId(zone))) return;
  // Persist BEFORE the ceremony, exactly like the chest: closing the app
  // mid-animation must never cost the kid a badge they already earned.
  unlocks.zones.push(badgeId(zone));
  await saveUnlocks();
  logEvent('zone_badge_earned', { zone: zone.id });
  const nextZone = ZONE_DEFS[ZONE_DEFS.indexOf(zone) + 1] || null;
  return showBadgeCeremony(zone, nextZone); // 'again' | 'map' | 'done'
}

// Grants a lesson's reward the first time ALL of its levels are cleared in a
// playthrough (skipped levels leave the chest for another run). Idempotent:
// an already-earned reward never re-opens the chest on replays.
async function maybeReward(lesson) {
  const reward = REWARDS[lesson.lesson_id];
  if (!reward || unlocks.animals.includes(reward.animal.emoji)) return;
  const allCleared = lesson.levels.every((_, i) =>
    playthroughCleared.has(`lesson${lesson.lesson_id}-level${i + 1}`));
  if (!allCleared) return;
  // Persist BEFORE the ceremony: closing the app mid-animation must never
  // cost the kid an unlock they already earned.
  unlocks.animals.push(reward.animal.emoji);
  await saveUnlocks();
  await showReward(reward);
}

// One full playthrough; resolves when "Play again" is tapped on the final
// lesson-complete screen, so the caller can route back through animal
// selection before the next playthrough. Best times stay — they're all-time
// records. startLessonId picks the opening lesson: the persisted resume
// point on a normal boot, or the lesson a welcome-map ⭐ tap chose. The
// island reset happens in the animal handler AFTER this returns ("Play
// again"), never here — a reload is not a reset. A map jump simply moves
// the lesson cursor: the tapped lesson restarts at its first Learn card,
// checkmarks and best times untouched.
async function runGame(lessons, audio, startLessonId = null) {
  let i = startLessonId == null ? 0
    : Math.max(0, lessons.findIndex((l) => l.lesson_id === startLessonId));
  // Where a consumed jump lands the cursor; an unknown id stays put.
  const jumpIndex = () => {
    const idx = lessons.findIndex((l) => l.lesson_id === jumpTargetId);
    jumpTargetId = null;
    return idx === -1 ? i : idx;
  };
  while (i < lessons.length) {
    // Everything taught before this lesson stays available inside it.
    const priorVocab = lessons.slice(0, i).flatMap((l) => l.commands);
    // Hint chips show only the newest words by default — this lesson's, or
    // for review lessons that introduce none (lesson 8) the most recent
    // lesson that taught any. Older words collapse behind a "more" toggle.
    const newestLesson = lessons[i].commands.length
      ? lessons[i]
      : [...lessons.slice(0, i)].reverse().find((l) => l.commands.length);
    const chipWords = new Set(
      (newestLesson?.commands || []).filter((c) => !c.no_chip).map((c) => c.word)
    );
    const lastResult = await runLesson(lessons[i], audio, priorVocab, chipWords);
    // The chest is the payoff — it appears automatically right after the
    // last level, BEFORE the lesson-complete screen with its options. It
    // also fires on a jump-unwind: if the jump came from the final
    // challenge-complete screen, the kid keeps the chest they just earned
    // (maybeReward is idempotent and a no-op unless every level cleared).
    if (lastResult === JUMP) {
      await maybeReward(lessons[i]);
      i = jumpIndex();
      continue;
    }
    await maybeReward(lessons[i]);
    // Always land on the lesson-complete screen — skipping the last level
    // arrives here too, just without a time or best badge (result null).
    const c = await stepOrJump(showComplete(
      `Level ${lessons[i].lesson_id} complete!`,
      i === lessons.length - 1 ? 'Play again 🔁' : 'Next level ▶',
      lastResult
    ));
    if (c === JUMP) { i = jumpIndex(); continue; }
    // Zone ceremony intercepts the Next tap when a zone was just finished
    // (chest → lesson-complete → badge, per the spec's order). Deliberately
    // NOT on the jump branch above: a kid who map-jumps away from this
    // screen hasn't tapped Next — the badge stays unearned and the ceremony
    // fires whenever the zone's last lesson is next completed.
    const zoneChoice = await maybeZoneCeremony(lessons, lessons[i]);
    if (zoneChoice === 'again') continue; // replay the zone's last lesson
    if (zoneChoice === 'map') {
      // "Move to Next Zone": show the world map with the next island now
      // visibly unlocked. "Let's go!" falls through to the next lesson; a
      // marker tap jumps there instead (no lesson step is awaiting here, so
      // the jump is handled directly rather than via signalJump).
      const choice = await openMap(lessons, { welcome: false, goLabel: "Let's go! ▶" });
      if (choice && choice.jump != null) {
        const idx = lessons.findIndex((l) => l.lesson_id === choice.jump);
        if (idx !== -1) { i = idx; continue; }
      }
    }
    i++;
  }
  // No playthrough active: a stray marker tap must not fire a stale signal.
  signalJump = null;
  activeLessonId = null;
}

async function init() {
  // index.html carries the version as static text so it paints immediately.
  // This only corrects it when the two disagree — which means the HTML and
  // the JS came from different builds, i.e. one of them is a stale cached
  // copy. That's the signal the old unconditional repaint existed to give.
  if ($('version').textContent !== `v${APP_VERSION}`) {
    $('version').textContent = `v${APP_VERSION}`;
  }

  // i18n boots here — its detect() reads the stored 'axo_lang' choice, then
  // the browser's language — before anything paints a card or caption.
  // The locale scripts + js/i18n.js are plain synchronous
  // scripts loaded ahead of this module in index.html, so window.i18n always
  // exists by now.
  const i18n = window.i18n;
  i18n.init();

  // 🌍 language control — same #btn-gloss id/element as the old RU toggle
  // (renaming would touch CSS and learn-screen markup for no gain), new job:
  // it shows the active language and opens the picker sheet. It lives on the
  // Learn word card, so a language change re-renders the visible card's
  // caption via refreshLearnGloss; Play-phase chips need no live refresh —
  // the button isn't reachable there and chips rebuild on every challenge.
  const globeBtn = $('btn-gloss');
  const langSheet = $('lang-sheet');
  const langList = $('lang-list');
  const paintGlobe = () => {
    globeBtn.textContent = `🌍 ${i18n.LANG_LABELS[i18n.lang]}`;
  };
  globeBtn.onclick = () => {
    // Rows rebuilt on every open: cheap, and the ✓ always sits on the
    // current language without separate bookkeeping.
    langList.innerHTML = '';
    for (const code of i18n.SUPPORTED) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'lang-row';
      const label = document.createElement('span');
      label.className = 'lang-label';
      label.textContent = i18n.LANG_LABELS[code];
      row.appendChild(label);
      const name = document.createElement('span');
      name.textContent = `· ${i18n.LANG_NAMES[code]}`;
      row.appendChild(name);
      if (i18n.PROVISIONAL[code]) {
        // β: translation awaiting a native speaker's check (see the note
        // line at the bottom of the sheet).
        const beta = document.createElement('span');
        beta.className = 'lang-beta';
        beta.textContent = 'β';
        row.appendChild(beta);
      }
      if (code === i18n.lang) {
        const check = document.createElement('span');
        check.className = 'lang-check';
        check.textContent = '✓';
        row.appendChild(check);
      }
      row.onclick = () => {
        i18n.setLang(code); // persists to 'axo_lang' + re-applies [data-*]
        paintGlobe();
        langSheet.hidden = true;
        refreshLearnGloss(); // captions need card context — re-render, not text swap
      };
      langList.appendChild(row);
    }
    langSheet.hidden = false;
  };
  // Tap on the dimmed backdrop closes without changing anything.
  langSheet.onclick = (e) => { if (e.target === langSheet) langSheet.hidden = true; };
  paintGlobe();

  // The demo ships lessons 1-2; every file listed here must exist under data/.
  const lessons = await Promise.all(
    ['lesson1', 'lesson2'].map((name) =>
      fetch(`./data/${name}.json`).then((r) => r.json())
    )
  );
  // Continuous level numbering across lessons: each lesson knows the count
  // of levels before it, so "Level N" keeps growing through the whole game.
  let levelNo = 0;
  for (const l of lessons) {
    l.level_offset = levelNo;
    levelNo += l.levels.length;
    // contentVersion rides along on the parsed lesson object (l.contentVersion)
    // — no enforcement yet, just the hook for future content migrations.
    if (l.contentVersion === undefined) {
      console.warn(`[content] lesson ${l.lesson_id} missing contentVersion field`);
    }
    // Telemetry annotations: play.js logs run_pressed from inside a level,
    // where lesson/level numbers aren't otherwise known.
    l.levels.forEach((lv, i) => { lv._lesson = l.lesson_id; lv._level = i + 1; });
  }

  // Reload is not a reset: restore this playthrough's cleared levels and
  // resume point from storage BEFORE anything renders the map. Mid-lesson
  // position is deliberately not persisted — a reload mid-lesson restarts
  // that lesson at its first Learn card. Only "Play again" and a new player
  // name reset this state (both also persist the reset).
  const run = await getRunState();
  for (const id of run.runCleared) playthroughCleared.add(id);
  // Clamp: a fully-finished run parks the resume point one past the last
  // lesson — resume at the last lesson rather than falling back to 1.
  let resumeLessonId = Math.min(
    run.furthestLesson, lessons[lessons.length - 1].lesson_id
  );

  const audio = new AudioManager();

  // Music toggle — reflects the saved preference immediately, so a returning
  // muted player sees 🔇 before any music would have started.
  const muteBtn = $('btn-mute');
  const paintMute = () => {
    muteBtn.classList.toggle('muted', audio.muted); // CSS draws the slash
    muteBtn.setAttribute('aria-label', audio.muted ? 'Turn music on' : 'Turn music off');
  };
  muteBtn.onclick = () => {
    audio.setMuted(!audio.muted);
    paintMute();
    showToast(audio.muted ? 'Music off' : 'Music on 🎵');
  };
  paintMute();

  // Voice toggle — independent of the music one: 🗣 silences the TTS voice
  // everywhere (word cards, letters, celebrations). Same persisted-device-
  // preference pattern, painted before anything can speak.
  const voiceBtn = $('btn-voice');
  const paintVoice = () => {
    voiceBtn.classList.toggle('muted', audio.voiceMuted); // CSS draws the slash
    voiceBtn.setAttribute('aria-label', audio.voiceMuted ? 'Turn voice on' : 'Turn voice off');
  };
  voiceBtn.onclick = () => {
    audio.setVoiceMuted(!audio.voiceMuted);
    paintVoice();
    showToast(audio.voiceMuted ? 'Voice off' : 'Voice on 🗣');
  };
  paintVoice();

  // Animal choice is one-time at game start (remembered across visits);
  // later lessons and replays keep the chosen animal. Saved choices from
  // before the roster change land on the replacement animal.
  let savedAnimal = await storage.get(ANIMAL_KEY);
  if (EMOJI_SWAP[savedAnimal]) {
    savedAnimal = EMOJI_SWAP[savedAnimal];
    await storage.set(ANIMAL_KEY, savedAnimal);
  }
  if (savedAnimal) setPlayerEmoji(savedAnimal);
  const animalBtns = document.querySelectorAll('.animal-btn');
  // Locked friends stay visible (something to look forward to) but greyed
  // with a padlock; tapping one explains how to earn it. Repainted before
  // each visit to the picker, since a chest may have just unlocked one.
  // Boolean() matters: buttons without data-unlock would yield undefined,
  // and classList.toggle(cls, undefined) FLIP-toggles instead of removing —
  // which painted the always-available animals as locked.
  const isLocked = (btn) =>
    Boolean(btn.dataset.unlock && !unlocks.animals.includes(btn.dataset.animal));
  const paintAnimals = () => {
    for (const btn of animalBtns) {
      btn.classList.toggle('animal-locked', isLocked(btn));
    }
  };
  paintAnimals();
  for (const btn of animalBtns) {
    btn.classList.toggle('animal-current', btn.dataset.animal === savedAnimal);
    btn.onclick = async () => {
      if (isLocked(btn)) {
        btn.classList.add('wiggle');
        setTimeout(() => btn.classList.remove('wiggle'), 400);
        showToast(`Finish Level ${btn.dataset.unlock} to unlock! 🔒`);
        return;
      }
      setPlayerEmoji(btn.dataset.animal);
      await storage.set(ANIMAL_KEY, btn.dataset.animal);
      logEvent('animal_selected', { animal: btn.dataset.animal });
      for (const b of animalBtns) {
        b.classList.toggle('animal-current', b === btn);
      }
      // Same flow every playthrough: welcome + island map, then the lessons.
      // No island clear here (v0.65 had one): a reload resumes the restored
      // run, so the welcome map may legitimately show ⭐s. The reset moved
      // below, to the "Play again" landing — the only true fresh start.
      const choice = await openMap(lessons, { welcome: true });
      if (choice === 'back') {
        // Changed their mind about the animal — back to picking.
        showScreen('animal');
        return;
      }
      // A ⭐ tap on the welcome map starts at that lesson; "Let's go!" (or
      // the pulsing marker) resumes at the persisted resume point.
      const startId = choice && choice.jump != null ? choice.jump : resumeLessonId;
      await runGame(lessons, audio, startId);
      // "Play again" landed us here: fresh island for the next playthrough,
      // in memory AND persisted — a reload right after "Play again" must
      // still boot an unchecked island. Best times stay all-time records.
      playthroughCleared.clear();
      resumeLessonId = 1;
      await resetRun();
      // Back to animal choice — keep the same friend or switch — before the
      // next playthrough starts. Repaint the locks first: this run may have
      // earned a new friend.
      progressEl.hidden = true;
      paintAnimals();
      showScreen('animal');
    };
  }

  // Name lives on the start screen, prefilled on return visits — a returning
  // kid just taps Play. The submit tap is also the mobile audio unlock.
  const nameInput = $('name-input');
  // The inline script in index.html has already prefilled the device's last
  // name so the field isn't empty for a beat. This is the authoritative
  // per-user value; only overwrite when there IS one, so the instant prefill
  // survives (a saved name and the echo agree for a returning kid).
  const savedName = await getPlayerName();
  if (savedName) {
    nameInput.value = savedName;
  }
  $('start-form').onsubmit = async (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.classList.add('wiggle');
      setTimeout(() => nameInput.classList.remove('wiggle'), 400);
      nameInput.focus();
      return;
    }
    // A different name means a new player on this device: earned animals,
    // zone badges AND best times belong to the kid who earned them, so all
    // reset — along with the previous kid's in-progress run (clearTimes
    // persists that; the in-memory copies restored at boot reset here).
    // Same name (prefilled for returning kids) keeps everything.
    const prevName = await getPlayerName();
    if (prevName && name.toLowerCase() !== prevName.toLowerCase()) {
      unlocks.animals = [];
      unlocks.zones = [];
      await saveUnlocks();
      paintAnimals();
      await clearTimes();
      playthroughCleared.clear();
      resumeLessonId = 1;
    }
    await setPlayerName(name);
    audio.unlock();
    audio.startMusic();
    showScreen('animal');
  };

  // Leaderboard and map open from the complete screen; Back returns to it,
  // so the pending Next Level / Next lesson button is where the kid left it.
  $('btn-leaderboard').onclick = async () => {
    await renderLeaderboard(lessons);
    showScreen('leaderboard');
  };
  $('btn-lb-back').onclick = () => showScreen('complete');

  // Map as a detour from anywhere (complete screens or mid-lesson via the
  // header 🗺): remember where the kid was and go back exactly there. If the
  // game flow moved the screen itself while the map was open (e.g. a running
  // sequence finished and showed the complete screen), don't override it.
  let mapPeekBusy = false;
  // Set while a peek is open: closes it the way the map's own ⬅ Back button
  // does. See the toggle branch in peekMap.
  let closePeek = null;
  const peekMap = async () => {
    // The header 🗺 sits OUTSIDE the screen sections, so it stays tappable
    // while the map itself is open — and kids (and desktop users, who don't
    // want to travel to the Back button) treat it as a toggle. It IS one:
    // a second tap closes the peek by clicking the map's own Back button, so
    // the close path is literally the same code — same resolve, same
    // deadlock watchdog, same return-to-where-you-were. Nothing is
    // duplicated here, which is the point: two ways in, one way out.
    // Re-entrancy guard (v0.71) still stands, and is what makes that safe:
    // a second tap must never run openMap AGAIN with returnTo === 'map',
    // which orphaned the first map's promise and re-pointed every button at
    // a new one — Back then "closed" the map back onto the map and every
    // later tap resolved an already-settled promise: the wedged,
    // all-buttons-inert map. Still one live peek at a time.
    if (currentScreen === 'map') {
      if (closePeek) {
        mapDbg('peek toggled closed via 🗺');
        closePeek();
        return;
      }
      // A map this button didn't open (welcome map, post-ceremony map) —
      // its Back button means "start playing", not "go back", so closing it
      // from here would fire the wrong flow. Left inert, exactly as before.
      mapDbg('peek ignored — map already open (not a peek)');
      return;
    }
    if (mapPeekBusy) {
      mapDbg('peek ignored — a peek is still closing');
      return;
    }
    mapPeekBusy = true;
    try {
      const returnTo = currentScreen;
      mapDbg('peek open', { returnTo, jumpArmed: Boolean(signalJump) });
      // Armed for the whole life of this peek: the map's Back button is
      // wired synchronously inside openMap's promise executor below, and a
      // tap can only reach us after that. Cleared in the finally, so a
      // stale toggle can never click a button belonging to a closed peek.
      closePeek = () => $('btn-map-go').click();
      pauseRun(); // freeze a mid-run sequence (and its clock) while peeking
      const choice = await openMap(lessons, { welcome: false, fallbackTo: returnTo });
      mapDbg('map resolved', { choice, jumpArmed: Boolean(signalJump) });
      if (choice && choice.jump != null && signalJump) {
        // Marker tap: abandon the paused level (abortRun unblocks its frozen
        // run loop, which exits without touching the DOM) and unwind the
        // lesson flow to the tapped lesson's first Learn card. Progress and
        // best times keep.
        logEvent('map_jump', { from: activeLessonId, to: choice.jump });
        abortRun();
        signalJump(choice.jump);
        return;
      }
      if (choice && choice.jump != null) {
        // Marker tapped while no lesson step was listening (signalJump
        // cleared — e.g. the reward chest is up). The jump can't be honored;
        // fall through and close the map back to where the kid was instead
        // of leaving a dead map on screen.
        logEvent('map_jump_ignored', { to: choice.jump, at: returnTo });
        mapDbg('jump ignored — no step listening', { to: choice.jump });
      }
      resumeRun();
      if (currentScreen === 'map') {
        showScreen(returnTo);
        // Back from the map onto a challenge: the detour stole input focus —
        // put the caret back so typing works without a tap. refocusRun no-ops
        // if a paused sequence just resumed animating (keyboard would cover
        // the grid) or if the flow already moved past the level.
        if (returnTo === 'play') refocusRun();
      }
    } finally {
      mapPeekBusy = false;
      closePeek = null;
    }
  };
  $('btn-map').onclick = peekMap;
  $('btn-map-peek').onclick = peekMap;

  // Manual-testing hook, localhost only —
  // lets the founder force zone/map states from the DevTools console instead
  // of replaying 10-20 lessons. Never defined in production.
  //   zoneTest.setProgress(11)   → lessons 1-10 read as cleared this
  //     playthrough, "now" marker on 11 (in MEMORY only: reopen the map to
  //     see it; a reload restores the real saved run)
  //   zoneTest.setBadges('spark')/ setBadges() → overwrite earned badges
  //     (PERSISTED, exactly like a real earn — also how to re-arm a ceremony:
  //     setBadges() clears them so it can fire again)
  //   zoneTest.preview('twilight') → play that zone's full ceremony now,
  //     granting nothing ('atlantis' previews the final-zone parade)
  const host = location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    window.zoneTest = {
      setProgress(nextLessonId) {
        playthroughCleared.clear();
        for (const l of lessons) {
          if (l.lesson_id >= nextLessonId) continue;
          l.levels.forEach((_, i) =>
            playthroughCleared.add(`lesson${l.lesson_id}-level${i + 1}`));
        }
        return `lessons below ${nextLessonId} cleared in memory — open the map`;
      },
      async setBadges(...ids) {
        unlocks.zones = ids;
        await saveUnlocks();
        return `zones: [${ids.join(', ')}] (persisted)`;
      },
      async preview(zoneId) {
        const zi = ZONE_DEFS.findIndex((z) => z.id === zoneId);
        if (zi === -1) return `unknown zone — use ${ZONE_DEFS.map((z) => z.id).join(' / ')}`;
        const wasOn = currentScreen;
        await showBadgeCeremony(ZONE_DEFS[zi], ZONE_DEFS[zi + 1] || null);
        showScreen(wasOn);
        return 'ceremony finished';
      },
    };
  }
}

init().catch((err) => {
  showToast('Oops, could not load the lesson 😿');
  console.error(err);
});
