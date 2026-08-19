// Play phase for one level: type commands with a real keyboard (native
// mobile keyboard on phones), build a sequence, run it, and guide the animal
// to the goal. Reaching the goal mid-sequence counts — extra commands are
// just ignored. No fail states: a typo wiggles with a hint, a missed run
// resets to start with a gentle prompt and the sequence stays editable.
import { Grid, runCommand, flyTo } from './grid.js';
import { logEvent } from './telemetry.js';
import { SPEECH_PHASES, CHIP_SPEECH_PHASES, SPEAK_RUN_COMMANDS } from './audio.js';
import { captionFor } from './gloss.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_SEQUENCE = 12;

// Hint-chip collapse config — same phase-gate style as audio.js's
// SPEECH_PHASES sets, so where chips collapse is a one-line edit.
// 'challenge' is the player-facing name of this file's phase (audio's gates
// spell it 'play'; kept as specced so the two gates read independently).
// Learn is deliberately NOT in the set: if a Learn chip row ever exists, it
// shows everything. By lesson 10 the vocabulary is 14 chips, so Challenge
// collapses to the first CHIP_COLLAPSED_COUNT behind one "+N more" toggle
// to keep the row readable for young readers.
const CHIP_COLLAPSED_COUNT = 3;
const CHIP_COLLAPSE_PHASES = new Set(['challenge']);

// Hint chips: the available words at a glance. Tap-to-hear rides
// CHIP_SPEECH_PHASES, which includes 'play' — a chip tap is the kid asking
// for the word, scaffolded recall on demand, so it stays voiced in Challenge
// even though nothing else there speaks. (Its own gate, not SPEECH_PHASES:
// that one keeps the unbidden typed-command echo silent.) The 🔊 comes off
// the label whenever the phase is silent, so a chip never promises audio it
// won't give.
// Module-level (not inside runPlayPhase) so the scratchpad harness can
// machine-verify the collapse/toggle states without booting a level.
export function renderHintChips(hintsEl, commands, chipWords, audio) {
  hintsEl.innerHTML = '';
  const makeChip = (cmd) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'hint-chip';
    // chip_label (optional) decorates the button text only — "⬅ go-left"
    // so a direction never has to be resolved from the word alone. Input
    // matching is untouched: it keys off word/base as always.
    const label = cmd.chip_label || cmd.word;
    const wordEl = document.createElement('span');
    wordEl.textContent = CHIP_SPEECH_PHASES.has('play') ? `🔊 ${label}` : label;
    b.appendChild(wordEl);
    // Silent gloss caption under the English word (js/gloss.js precedence:
    // card gloss, then locale dictionary, else no element at all). Text
    // only — the tap-to-hear above stays the English Jenny clip. No live
    // re-render on language change needed: the 🌍 control is only reachable
    // on Learn cards, and chips rebuild on every challenge entry.
    const caption = captionFor(cmd);
    if (caption) {
      const glossEl = document.createElement('span');
      glossEl.className = 'chip-gloss';
      glossEl.textContent = caption;
      b.appendChild(glossEl);
    }
    b.onclick = () => {
      if (CHIP_SPEECH_PHASES.has('play')) audio.playWord(cmd.audio_key, cmd.spoken_phrase);
    };
    hintsEl.appendChild(b);
    return b;
  };
  // Current lesson's words first (chipWords), older vocabulary after — a
  // collapsed row always leads with the newest words.
  const fresh = chipWords && chipWords.size
    ? commands.filter((c) => chipWords.has(c.word))
    : commands;
  const older = commands.filter((c) => !fresh.includes(c));
  const chips = [...fresh, ...older].map(makeChip);
  // Collapse only in a collapse phase, and only when there is actually
  // something to hide.
  if (!CHIP_COLLAPSE_PHASES.has('challenge') || chips.length <= CHIP_COLLAPSED_COUNT) return;
  // The toggle is a CONTROL, not a vocabulary chip: appended AFTER every
  // chip so it is structurally always LAST, and it gets no gloss caption,
  // no 🔊, no audio. (The old row appended the hidden chips after the
  // toggle, which left it stranded mid-row once v0.90's display:inline-flex
  // stopped [hidden] from hiding chips at all — see .hint-chip[hidden].)
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'hint-chip';
  hintsEl.appendChild(toggle);
  let open = false; // default COLLAPSED: first N words only
  const paint = () => {
    chips.forEach((b, i) => { b.hidden = !open && i >= CHIP_COLLAPSED_COUNT; });
    // Label always mirrors the CURRENT state — count while collapsed,
    // "Show less" while expanded, never a stale "+N more".
    toggle.textContent = open
      ? 'Show less'
      : `+${chips.length - CHIP_COLLAPSED_COUNT} more`;
  };
  toggle.onclick = () => { open = !open; paint(); };
  paint();
}

// Map-peek pause: main.js freezes the active level while the map detour is
// open — a mid-run sequence stops between steps and the level clock stops
// counting, instead of the run continuing invisibly behind the map. Only
// the level currently on screen registers itself here.
let activeRun = null;
export function pauseRun() { activeRun?.pause(); }
export function resumeRun() { activeRun?.resume(); }
// A map jump abandons the level mid-flight: mark it aborted and release any
// frozen waiters so the run loop can EXIT (it checks `aborted` after every
// wait and bails without touching the DOM) instead of holding the old grid
// alive at waitWhilePaused forever. Dropping the registration still
// guarantees a later peek's pause/resume can never reach the orphaned run.
// Idempotent: a second call finds activeRun already null and no-ops.
export function abortRun() { activeRun?.abort(); activeRun = null; }
// Map-peek return: put the caret back in the command input (the detour may
// have stolen focus). Delegates to the active level so the mid-run check
// applies; no-ops between levels or when the flow already moved on.
export function refocusRun() { activeRun?.refocus(); }

// Focus the command input so typing works the moment the challenge appears —
// kids react to the grid faster than they remember to tap the input first.
// Double-rAF waits for the freshly-unhidden screen to actually paint, so
// focus never lands mid-layout; preventScroll stops the browser nudging the
// page to bring the caret into view. Mobile: iOS shows the caret WITHOUT
// popping the keyboard on programmatic focus (keyboard appears on the kid's
// first real tap — desired, the grid stays visible); Android may open the
// keyboard right away, which is acceptable.
function focusInput(input) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    input.focus({ preventScroll: true });
  }));
}

// Case- and punctuation-insensitive: "Turn Left", "turnleft" and "turn-left"
// all match turn-left — kids aren't penalized for hyphens or capitals. Digits
// survive so counts can be read back out: "go(3)", "go 3" and "go3" are all
// the same input.
const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// Splits typed input into the word part and an optional count — the go(N)
// shortcut from lesson 3, accepted on every command. count is null when no
// number was typed (plain "go"), which is distinct from an explicit 0.
function parseCommand(typed) {
  const m = normalize(typed).match(/^([a-z]+?)(\d*)$/);
  if (!m) return null;
  return { key: m[1], count: m[2] === '' ? null : parseInt(m[2], 10) };
}

// A collected coin flies from its tile to the lesson counter — quick arc,
// under half a second, so the pickup lands somewhere visible. The motion
// itself now lives in grid.js (the learn phase flies coins into its demo
// pouch the same way); this keeps the play-phase rule that there is nothing
// to fly TO while the counter is hidden.
function flyCoin(fromEl, counterEl) {
  if (counterEl.hidden) return;
  flyTo(fromEl, counterEl);
}

// Milestone moment: a handful of sparkles scattering from the counter —
// a quick "ding" of acknowledgment, not a ceremony.
function sparkleBurst(anchorEl) {
  const r = anchorEl.getBoundingClientRect();
  for (let i = 0; i < 6; i++) {
    const s = document.createElement('span');
    s.className = 'sparkle-burst';
    s.textContent = '✨';
    s.style.left = `${r.left + r.width / 2}px`;
    s.style.top = `${r.top + r.height / 2}px`;
    s.style.setProperty('--dx', `${(Math.random() * 2 - 1) * 64}px`);
    s.style.setProperty('--dy', `${(Math.random() * 2 - 1) * 64}px`);
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 700);
  }
}

// Resolves { outcome: 'done', timeMs, lines, coins } when the goal is reached
// (timeMs clocked from level start to goal, retries included, celebration
// excluded; lines = program length for the star rating; coins = { got, total }
// or null when the level has no collectibles), or { outcome: 'skip' } /
// { outcome: 'back' } for one-step navigation. Back/Skip are inert while a
// sequence is animating. coinCtx = { banked, show }: the lesson-wide coin
// tally banked from already-completed levels, and whether this lesson shows
// the counter at all (it has coins somewhere).
export function runPlayPhase(els, level, commands, audio, showToast, canGoBack, coinCtx = null, chipWords = null) {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    // Pause plumbing: the run loop awaits waitWhilePaused() before every
    // step, and pausedTotal is subtracted from the level clock — time spent
    // looking at the map never counts against the kid's best time.
    let paused = false;
    let pausedAt = 0;
    let pausedTotal = 0;
    let pauseWaiters = [];
    let aborted = false; // set by abortRun() on a map jump — the loop bails
    const me = {
      pause() {
        if (paused) return;
        paused = true;
        pausedAt = performance.now();
      },
      resume() {
        if (!paused) return;
        paused = false;
        pausedTotal += performance.now() - pausedAt;
        for (const w of pauseWaiters) w();
        pauseWaiters = [];
      },
      // Map jump abandoned this level: flag it and wake any frozen waiters
      // so the run loop exits at its next `aborted` check instead of staying
      // parked at waitWhilePaused forever, holding the old grid alive.
      abort() {
        aborted = true;
        // Queued run narration belongs to a level the kid just left.
        audio.resetNarration();
        if (!paused) return;
        paused = false;
        for (const w of pauseWaiters) w();
        pauseWaiters = [];
      },
      // Guarded here (not at the call site) because only this closure knows
      // whether a sequence is animating: refocusing mid-run would pop the
      // mobile keyboard over the moving animal right after runBtn blurred
      // the input on purpose.
      refocus() {
        if (!running) focusInput(els.input);
      },
    };
    activeRun = me;
    const waitWhilePaused = () =>
      paused ? new Promise((r) => pauseWaiters.push(r)) : Promise.resolve();
    // Identity guard: an aborted run's late finish (e.g. a celebration that
    // was already past its pause checks when the jump hit) must never drop
    // the NEXT level's registration.
    const finish = (result) => {
      if (activeRun === me) activeRun = null;
      resolve(result);
    };
    const [cols, rows] = level.grid_size;
    // The grand finale tours every command in the game and legitimately
    // needs a longer program than the everyday cap allows.
    const maxLines = level.max_lines || MAX_SEQUENCE;

    // Lesson coin counter: starts at what earlier levels banked; this run's
    // pickups add on top. A retry rebuilds the grid, so the tally falls
    // back to the banked amounts — no double counting. Coins and gems are
    // counted separately (🪙 2  💎 1); the gem part only appears in lessons
    // that have gems at all.
    const showCounter = Boolean(coinCtx && coinCtx.show);
    const showGems = Boolean(coinCtx && coinCtx.gems);
    // Keys are per-challenge inventory (spent on gates, never banked across
    // challenges) — the 🔑 section shows keys HELD right now.
    const showKeys = (level.keys || []).length > 0;
    const banked = coinCtx ? coinCtx.banked : { coin: 0, gem: 0 };
    let tally = { ...banked };
    let keysHeld = 0;
    const paintCounter = (popIt) => {
      els.coinCounter.hidden = !(showCounter || showKeys);
      els.coinPart.hidden = !showCounter;
      els.coinCount.textContent = tally.coin;
      els.gemPart.hidden = !showGems;
      els.gemCount.textContent = tally.gem;
      els.keyPart.hidden = !showKeys;
      els.keyCount.textContent = keysHeld;
      if (popIt) {
        els.coinCounter.classList.remove('pop');
        void els.coinCounter.offsetWidth; // restart the animation
        els.coinCounter.classList.add('pop');
      }
    };
    // Rebuilt from scratch on every retry so broken stones come back.
    function buildGrid() {
      const g = new Grid(els.grid, cols, rows);
      g.setGoal(level.goal.x, level.goal.y, level.goal.type);
      for (const ob of level.obstacles || []) {
        g.setObstacle(ob.x, ob.y, ob.type);
      }
      for (const item of level.items || []) {
        g.setItem(item.x, item.y, item.type);
      }
      for (const k of level.keys || []) g.setKey(k.x, k.y);
      for (const sw of level.switches || []) g.setSwitch(sw.x, sw.y, sw.opens);
      // Fog goes on LAST so its overlay covers whatever the level already
      // placed on that tile (obstacle, item, key — or nothing at all).
      for (const f of level.fog || []) g.setFog(f.x, f.y);
      g.setPlayer(level.start.x, level.start.y, level.start.facing);
      // Pickup feedback: coin flies to the counter, counter pops when it
      // lands, and every 5th lesson coin earns a sparkle burst.
      g.onCollect = (item) => {
        flyCoin(item.el, els.coinCounter);
        setTimeout(() => {
          // Milestone still counts VALUE (gem = 3) so gems get you there
          // faster, but the display counts pieces per type.
          const prevValue = tally.coin + tally.gem * 3;
          tally[item.type === 'gem' ? 'gem' : 'coin']++;
          paintCounter(true);
          const value = tally.coin + tally.gem * 3;
          if (Math.floor(value / 5) > Math.floor(prevValue / 5)) {
            sparkleBurst(els.coinCounter);
            showToast('Nice collecting! ✨');
            // Celebration, not command narration — stays voiced on purpose.
            audio.playPhrase('coin_milestone', 'super!');
          }
        }, 350); // increment as the coin arrives, not when it takes off
      };
      g.onKeyPickup = (el) => {
        flyCoin(el, els.coinCounter);
        setTimeout(() => { keysHeld++; paintCounter(true); }, 350);
      };
      g.onKeySpent = () => {
        keysHeld = Math.max(0, keysHeld - 1);
        paintCounter(true);
      };
      return g;
    }
    let grid = buildGrid();
    paintCounter(false);

    let sequence = [];
    let running = false;
    // Lookup maps keyed by the EXECUTABLE word. Cards that teach a decorated
    // form (word "repeat(4)", base "repeat") register under their base, but
    // only if no canonical entry claims it first — so plain "go" still maps
    // to the real go card, not the go(2) teaching card.
    const byWord = {};
    const byNorm = {};
    for (const c of commands) {
      if (c.base) continue;
      byWord[c.word] = c;
      byNorm[normalize(c.word)] = c;
    }
    for (const c of commands) {
      if (!c.base) continue;
      if (!byWord[c.base]) byWord[c.base] = c;
      if (!byNorm[normalize(c.base)]) byNorm[normalize(c.base)] = c;
    }
    // Loop balance so far: more repeats than ends = a block is still open.
    const openRepeat = () =>
      sequence.filter((e) => e.word === 'repeat').length >
      sequence.filter((e) => e.word === 'end').length;

    // The typed program as numbered lines (code-editor style). Sequence
    // entries are { word, count }: go(3) is ONE line with a ×3 badge, not
    // three lines. Lines between repeat(N) and end are indented with a
    // gutter border, code-editor style; during loop playback the repeat
    // line carries a "2/4" iteration badge (loop = { at, text }). During a
    // run, activeIndex highlights the line whose action the animal is doing
    // right now, and remaining makes its ×N badge count down in step with
    // the moves — the caller re-renders at the start of each step, so
    // highlight and movement stay in lockstep.
    function renderSequence(activeIndex = -1, remaining = 0, loop = null) {
      els.sequence.innerHTML = '';
      let depth = 0;
      sequence.forEach((entry, i) => {
        const isRepeat = entry.word === 'repeat';
        const isEnd = entry.word === 'end';
        if (isEnd) depth = Math.max(0, depth - 1);
        const line = document.createElement('li');
        line.className = 'code-line'
          + (i === activeIndex ? ' line-active' : '')
          + (depth > 0 && !isRepeat ? ' line-inside' : '');
        line.append(isRepeat ? `repeat(${entry.count})` : entry.word);
        if (isRepeat && loop && loop.at === i) {
          const badge = document.createElement('span');
          badge.className = 'loop-badge';
          badge.textContent = loop.text;
          line.appendChild(badge);
        }
        if (!isRepeat && entry.count > 1) {
          const badge = document.createElement('span');
          badge.className = 'count-badge';
          badge.textContent = `×${i === activeIndex && remaining ? remaining : entry.count}`;
          line.appendChild(badge);
        }
        if (isRepeat) depth++;
        line.title = 'Tap to remove';
        line.onclick = () => {
          if (running) return;
          sequence.splice(i, 1);
          renderSequence();
        };
        els.sequence.appendChild(line);
        if (i === activeIndex) line.scrollIntoView({ block: 'nearest' });
      });
      if (sequence.length === 0) {
        const hint = document.createElement('li');
        hint.className = 'code-hint';
        hint.textContent = 'Type a word 👇';
        els.sequence.appendChild(hint);
      }
    }

    // Hint-chip row — built by the module-level renderHintChips (collapsed
    // by default in Challenge, see CHIP_COLLAPSE_PHASES at the top of this
    // file).
    renderHintChips(els.hints, commands, chipWords, audio);

    els.input.value = '';
    // Keep the mobile keyboard up across ➕ taps: a tap on the button would
    // normally move focus off the input and dismiss the keyboard, forcing the
    // kid to tap the input again before every command. Cancelling mousedown
    // stops the focus shift without touching the click (so submit still
    // fires) — mobile browsers deliver an emulated mousedown before focus
    // moves, so this covers phones and desktop alike. Deliberately NOT done
    // on touchstart: preventDefault there suppresses the compatibility click
    // and the button would stop adding commands at all.
    els.addBtn.onmousedown = (e) => e.preventDefault();
    els.form.onsubmit = (e) => {
      e.preventDefault();
      if (running) return;
      const typed = els.input.value.trim();
      if (!typed) return;
      const parsed = parseCommand(typed);
      const cmd = parsed && byNorm[parsed.key];
      if (!cmd) {
        els.input.classList.add('wiggle');
        setTimeout(() => els.input.classList.remove('wiggle'), 400);
        showToast(`Try: ${commands.map((c) => c.word).join(' · ')} 🙂`);
        els.input.select();
        return;
      }
      // go(N) guard rails: an explicit 0 gets a friendly nudge, and N is
      // capped at the grid width so go(99) can't happen.
      if (parsed.count === 0) {
        showToast('Zero steps — nothing happens! Try a bigger number 🙂');
        els.input.select();
        return;
      }
      if (parsed.count > cols) {
        showToast(`Biggest number here is ${cols} 🙂`);
        els.input.select();
        return;
      }
      // Loop guard rails, all gentle: repeat needs its N, no nesting yet,
      // and end only makes sense after a repeat.
      const word = cmd.base || cmd.word;
      if (word === 'repeat') {
        if (parsed.count === null) {
          showToast('How many times? Try repeat(3) 🙂');
          els.input.select();
          return;
        }
        if (openRepeat()) {
          showToast('One repeat at a time for now! 🙂');
          els.input.select();
          return;
        }
      }
      if (word === 'end' && !openRepeat()) {
        showToast('Hmm, end needs a repeat before it! 🙂');
        els.input.select();
        return;
      }
      if (sequence.length >= maxLines) {
        showToast('That is a lot of steps — run it! ▶');
        return;
      }
      sequence.push({ word, count: word === 'end' ? 1 : parsed.count || 1 });
      logEvent('command_typed', { command: word }); // only valid, accepted commands
      renderSequence();
      // Panel is fixed-height with internal scroll: keep the newest line
      // in view so the kid sees what they just added.
      els.sequence.scrollTop = els.sequence.scrollHeight;
      // Typed-command echo — SPEECH_PHASES, which holds only 'learn', so this
      // stays silent in Challenge on purpose: typing is problem-solving time.
      // The hint chips speak (CHIP_SPEECH_PHASES) because the kid asked.
      if (SPEECH_PHASES.has('play')) audio.playWord(cmd.audio_key, cmd.spoken_phrase);
      els.input.value = '';
      // Belt-and-suspenders with the mousedown guard above: put the caret
      // back for the next command. Synchronous (not focusInput's double-rAF)
      // because iOS only honors a focus() that happens inside the tap's own
      // gesture — a deferred one shows the caret but leaves the keyboard shut.
      els.input.focus({ preventScroll: true });
    };

    els.clearBtn.onclick = () => {
      if (running) return;
      sequence = [];
      renderSequence();
    };

    els.backBtn.hidden = !canGoBack;
    els.backBtn.onclick = () => {
      if (!running) finish({ outcome: 'back' });
    };
    els.skipBtn.onclick = () => {
      if (!running) finish({ outcome: 'skip' });
    };

    // runCommand's effect sounds ('splash!', 'crunch!', 'yay!' …) ride the
    // same audio.play path and get TTS-SPOKEN while their MP3s are still
    // unrecorded — so play-phase runs hand runCommand a voiceless wrapper:
    // real clips (once recorded) still play, but the TTS fallback gets an
    // empty phrase and stays silent. Learn demos keep the full audio — the
    // splash is part of teaching the word. Same one-line re-enable as the
    // other gates: add 'play' to SPEECH_PHASES.
    const runAudio = SPEECH_PHASES.has('play')
      ? audio
      : { play: (key) => audio.play(key, '') };

    els.runBtn.onclick = async () => {
      if (running || sequence.length === 0) return;
      // Logged before the loop-structure check: a blocked run is still a
      // press. _lesson/_level are stamped onto the level by main.js's loader.
      logEvent('run_pressed', {
        lesson: level._lesson, level: level._level, sequenceLength: sequence.length,
      });
      // Loop structure check before anything moves — gentle, no fail state.
      let depth = 0;
      let strayEnd = false;
      for (const e of sequence) {
        if (e.word === 'repeat') depth++;
        if (e.word === 'end') { if (depth === 0) strayEnd = true; else depth--; }
      }
      if (depth > 0) {
        showToast('Don’t forget end! It tells the computer when to stop 🙂');
        return;
      }
      if (strayEnd) {
        showToast('Hmm, end needs a repeat before it! 🙂');
        return;
      }
      running = true;
      els.runBtn.disabled = true;
      els.input.blur(); // hide the mobile keyboard so the grid is visible
      // Narration is queued now, so a previous run's leftovers (a run the kid
      // cut short) must not speak over this one's first line.
      audio.resetNarration();

      const state = { ...level.start, keys: 0 };
      let reached = false;
      let collectNagged = false; // must_collect reminder shown once per run
      // Round-trip levels put the goal ON the start tile — the animal must
      // actually leave and come back; otherwise any no-move command (a lone
      // turn-left) would "reach" the goal instantly.
      let leftStart = false;

      // At the goal? (collect-then-escape exits only count once every item
      // is picked up — otherwise a gentle one-time reminder, no fail.)
      const atGoal = () => {
        if (state.x !== level.start.x || state.y !== level.start.y) leftStart = true;
        if (state.x !== level.goal.x || state.y !== level.goal.y) return false;
        if (!leftStart) return false;
        if (level.must_collect && grid.items.size > 0) {
          if (!collectNagged) {
            showToast('Pick up the treasure first! 💎');
            collectNagged = true;
          }
          return false;
        }
        return true;
      };

      // One sequence line: speak it, run its action count times with the
      // highlight (and loop badge, when inside a repeat) in lockstep.
      const execEntry = async (idx, loop) => {
        const entry = sequence[idx];
        const cmd = byWord[entry.word];
        // Fire-and-forget: the animal starts moving on this word, it does not
        // wait for the audio (TPR — word and action land together). Queues
        // behind the previous command's word rather than interrupting it or
        // dropping itself; see narrateCommand. entry.count is spoken too, so
        // go(3) says "go three" — the number the kid typed is part of the
        // command, not decoration.
        if (cmd && SPEAK_RUN_COMMANDS) {
          audio.narrateCommand(cmd.audio_key, cmd.spoken_phrase, entry.count);
        }
        for (let rep = 0; rep < entry.count; rep++) {
          await waitWhilePaused(); // map peek freezes the run between steps
          if (aborted) return false; // jumped away while frozen: stop here
          renderSequence(idx, entry.count - rep, loop);
          const changed = await runCommand(grid, state, entry.word, runAudio, showToast);
          if (aborted) return false; // jump landed mid-animation: no goal check
          if (atGoal()) return true;
          if (!changed) break; // blocked — repeating it would just re-bump
        }
        return false;
      };

      // Interpret the program: repeat(N) runs its block N times, with the
      // repeat line carrying an iteration badge (1/3, 2/3, …) the whole
      // time so the kid sees which lap the animal is on.
      let i = 0;
      while (i < sequence.length && !reached && !aborted) {
        const entry = sequence[i];
        if (entry.word === 'repeat') {
          const endIdx = sequence.findIndex((e, j) => j > i && e.word === 'end');
          const stop = endIdx === -1 ? sequence.length : endIdx;
          const rcmd = byWord.repeat;
          // Announced once as the loop badge lights up, not per lap — with
          // its count, matching the repeat(N) line on screen.
          if (rcmd && SPEAK_RUN_COMMANDS) {
            audio.narrateCommand(rcmd.audio_key, rcmd.spoken_phrase, entry.count);
          }
          for (let iter = 1; iter <= entry.count && !reached && !aborted; iter++) {
            await waitWhilePaused();
            if (aborted) break;
            const loop = { at: i, text: `${iter}/${entry.count}` };
            renderSequence(i, 0, loop); // repeat line lights up each lap
            await sleep(350);
            for (let k = i + 1; k < stop && !reached && !aborted; k++) {
              reached = await execEntry(k, loop);
            }
          }
          if (!reached && !aborted && endIdx !== -1) {
            renderSequence(endIdx); // end line blinks: the loop is done
            await sleep(300);
          }
          i = stop + 1;
          continue;
        }
        if (entry.word === 'end') { i++; continue; }
        reached = await execEntry(i, null);
        i++;
      }
      // Aborted mid-run (map jump): the flow moved on and this screen's DOM
      // now belongs to whatever replaced it — exit without rendering,
      // celebrating, or resetting anything. The promise stays unresolved on
      // purpose; its stepOrJump race already settled with JUMP.
      if (aborted) return;
      renderSequence();
      // The program is over: whatever is still queued belongs to lines the
      // animal has already finished, and must not run under the celebration.
      audio.resetNarration();

      if (reached) {
        const elapsedMs = Math.round(performance.now() - startedAt - pausedTotal);
        grid.celebrateGoal();
        // End-of-run celebration — outside the SPEECH_PHASES gate on purpose.
        await audio.playPhrase('goal_reached', 'Great job!');
        await sleep(900);
        finish({
          outcome: 'done',
          timeMs: elapsedMs,
          lines: sequence.length,
          coins: grid.totalCoins > 0
            ? {
                coin: grid.collected.coin,
                coinTotal: grid.totalByType.coin,
                gem: grid.collected.gem,
                gemTotal: grid.totalByType.gem,
              }
            : null,
        });
      } else {
        showToast('Almost! Try again 🙂');
        await sleep(900);
        grid = buildGrid(); // fresh board: obstacles restored, animal at start
        tally = { ...banked }; // this run's pickups are back on the board
        keysHeld = 0; // keys are back on their tiles too
        paintCounter(false);
        running = false;
        els.runBtn.disabled = false;
      }
    };

    renderSequence();
    els.runBtn.disabled = false;
    // Auto-focus on every challenge entry — first load, next-challenge
    // advance, and Back into a previous challenge all pass through here.
    // Deliberately NOT re-fired after a failed run: the grid just reset and
    // the kid is looking at the board; on Android a refocus would pop the
    // keyboard over it. Their next tap on the input restores focus normally.
    focusInput(els.input);
  });
}
