// Learn phase for one command: hear the word, tap its letters in order
// (phonics reinforcement), then watch a 1-strip demo of what it does.
import { Grid, runCommand, flyTo } from './grid.js';
import { captionFor } from './gloss.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The card currently on screen, for the 🌍 language switch: captions carry
// card context (ru_gloss, base), so changing language re-runs the caption
// render for the visible card — a blind [data-gloss] text swap can't apply
// the card-gloss-wins precedence. Harmless when no card is up: the gloss
// element sits inside the hidden Learn screen.
let activeCaption = null;
export function refreshLearnGloss() {
  if (!activeCaption) return;
  const { glossEl, command } = activeCaption;
  const caption = captionFor(command);
  glossEl.textContent = caption || '';
  glossEl.hidden = !caption;
}

// Card generation counter: bumped by every runLearnPhase call. Skip/Back can
// resolve a card while its demo animation is still running — before that
// leftover animation touches anything shared (the Next button, the demo
// grid), it checks it still belongs to the current card.
let cardGen = 0;

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Builds the demo strip in its "before" state: animal at start, obstacle or
// collectible in the path (water for jump, stone for remove, a coin under the
// animal for collect). Shown from the moment the word card appears, so the
// kid stares at the starting picture while typing.
// The pouch: what "collect" is FOR. A coin that just vanishes off the strip
// teaches nothing — the word only means something once the kid sees where
// the coin GOES. So a card whose demo has collectibles gets a 🪙 counter
// beside the strip, starting at 0, and the coin flies into it exactly the
// way it flies into the header counter during a level: same motion, same
// tile burst, same "+1" — the Learn card is a rehearsal of the real thing,
// not a different-looking cousin of it.
// Self-gating on demo_strip.items (today: only lesson 4's collect card), so
// no lesson JSON changes and future collectible cards get it for free.
function setupPouch(pouchEl, grid, command) {
  const hasItems = (command.demo_strip.items || []).length > 0;
  // pouchEl is a v0.83 element — undefined when a newer learn.js runs
  // against an older index.html (the deploy-subset case that broke the
  // v0.82 word-hint render). Skipping it degrades to the old behaviour.
  if (!pouchEl) return;
  pouchEl.hidden = !hasItems;
  if (!hasItems) return;
  const countEl = pouchEl.querySelector('.demo-pouch-count');
  let held = 0;
  countEl.textContent = held; // reset on every rebuild: this is the "before"
  // Same hook the play phase uses, so collectItem takes the same branch
  // (tile burst + "+1", item cleared at once) rather than the plain
  // float-up — one collect animation for a kid to learn, not two.
  grid.onCollect = (item) => {
    flyTo(item.el, pouchEl);
    setTimeout(() => {
      held++;
      countEl.textContent = held; // ticks as the coin ARRIVES, not as it leaves
      pouchEl.classList.remove('pop');
      void pouchEl.offsetWidth; // restart the animation
      pouchEl.classList.add('pop');
    }, 350); // matches the play-phase counter's timing
  };
}

function setupDemo(gridEl, command, pouchEl) {
  const [cols, rows] = command.demo_strip.size;
  const grid = new Grid(gridEl, cols, rows);
  for (const ob of command.demo_strip.obstacles || []) {
    grid.setObstacle(ob.x, ob.y, ob.type);
  }
  for (const item of command.demo_strip.items || []) {
    grid.setItem(item.x, item.y, item.type);
  }
  for (const k of command.demo_strip.keys || []) grid.setKey(k.x, k.y);
  // Fog last, covering whatever the strip placed on that tile — the scan
  // card's demo hides the water it then reveals.
  for (const f of command.demo_strip.fog || []) grid.setFog(f.x, f.y);
  // start_keys pre-loads the inventory — the "open" card demos the door
  // opening itself; finding keys is taught in the levels.
  // demo_strip.start (optional) overrides the classic left-edge facing-right
  // start — the absolute-direction cards need the animal placed so the
  // pre-move rotation and the walk both stay on the strip.
  const start = command.demo_strip.start || { x: 0, y: 0, facing: 'right' };
  const state = { ...start, keys: command.demo_strip.start_keys || 0 };
  grid.setPlayer(state.x, state.y, state.facing);
  // Inside setupDemo so every rebuild path — first render, 🔁 replay, the
  // watch/loop shows — resets the pouch to its "before" state for free.
  setupPouch(pouchEl, grid, command);
  return { grid, state };
}

// Fires the moment spelling completes: word spoken while the action plays, so
// the before → after change is tied directly to finishing the word. Same
// executor as the play phase. Cards teaching a count syntax like go(3) set
// demo_word/demo_count (the base action runs N times back to back); the
// repeat card sets demo_sequence — a small block of words run demo_count
// times over, e.g. ["go","turn-right"] ×4 traces a full square.
async function playDemo(demo, command, audio) {
  audio.playWord(command.audio_key, command.spoken_phrase);
  // Effect sounds ride the clip-with-TTS-fallback path, and with no MP3s
  // recorded yet the fallback SPOKE them ("splash!", "crunch!") over the
  // demos. Silenced the same way as play.js's runAudio: empty phrase
  // starves the TTS fallback; real clips still play once recorded.
  // interrupt: false kept so a future clip's fallback can never cancel the
  // word being pronounced.
  const fx = { play: (key) => audio.play(key, '', { interrupt: false }) };
  const words = command.demo_sequence || [command.demo_word || command.word];
  const times = command.demo_count || 1;
  for (let t = 0; t < times; t++) {
    for (const w of words) {
      await runCommand(demo.grid, demo.state, w, fx);
    }
  }
}

// The go(N) reveal: N "go" chips stack up as separate lines, hold a beat,
// then squish upward into a single "go(N)" chip — the shortcut IS those
// lines collapsed. Shown for two different N in a row (go(2), then go(3))
// so the kid learns the number varies, not that go(2) is a word to memorize.
async function playSquish(container, command) {
  const n = command.squish_count;
  container.hidden = false;
  container.innerHTML = '';
  const chips = [];
  for (let i = 0; i < n; i++) {
    const chip = document.createElement('span');
    chip.className = 'squish-chip';
    chip.textContent = command.demo_word || 'go';
    container.appendChild(chip);
    chips.push(chip);
  }
  await sleep(1200); // long beat: let the kid count the stacked lines
  // Every chip slides up onto the first one and fades — a literal squish.
  const top = chips[0].offsetTop;
  for (let i = 1; i < n; i++) {
    chips[i].style.transform = `translateY(${top - chips[i].offsetTop}px) scale(0.5)`;
    chips[i].style.opacity = '0';
  }
  await sleep(500);
  for (let i = 1; i < n; i++) chips[i].remove();
  chips[0].textContent = command.word; // "go(2)" pops out of the pile
  chips[0].classList.add('squish-result');
  await sleep(500);
}

// The repeat/end shows (command.loop_show picks the variant), all built on
// the same idea: the animal performs the demo pair N times while a lap
// badge counts ↻ 1/3 → 2/3 → 3/3 — repetition made visible in motion.
//   'pair'    (repeat card): the two command chips + lap badge.
//   'end'     (end card): same, plus a dimmed "end" chip that lights up
//             green with a "✋ stop!" cue when the laps finish — end marks
//             where repeating STOPS, it's not an action the animal does.
//   'program' (recap card): the full Play-phase structure — repeat(3) line,
//             indented commands, end line — with the executing line
//             highlighted and the lap badge on the repeat line, closing on
//             a green end line. Exactly what the kid is about to build.
async function playLoopShow(container, demo, command, audio) {
  const variant = command.loop_show || 'pair';
  const words = command.demo_sequence || ['go'];
  const times = command.demo_count || 2;
  // Same silenced-effects wrapper as playDemo: empty phrase starves the
  // TTS fallback, real clips still play once recorded.
  const fx = { play: (key) => audio.play(key, '', { interrupt: false }) };
  container.hidden = false;
  container.innerHTML = '';

  if (variant === 'program') {
    const prog = document.createElement('div');
    prog.className = 'mini-program';
    const mkLine = (text, inside) => {
      const line = document.createElement('div');
      line.className = 'mini-line' + (inside ? ' mini-inside' : '');
      line.textContent = text;
      prog.appendChild(line);
      return line;
    };
    const repLine = mkLine(`repeat(${times})`, false);
    const wordLines = words.map((w) => mkLine(w, true));
    const endLine = mkLine('end', false);
    container.appendChild(prog);
    const badge = document.createElement('span');
    badge.className = 'loop-badge';
    repLine.appendChild(badge);
    await sleep(900); // beat: read the whole structure first
    for (let lap = 1; lap <= times; lap++) {
      badge.textContent = `${lap}/${times}`;
      repLine.classList.add('mini-active');
      await sleep(400);
      repLine.classList.remove('mini-active');
      for (let i = 0; i < words.length; i++) {
        wordLines[i].classList.add('mini-active');
        await runCommand(demo.grid, demo.state, words[i], fx);
        wordLines[i].classList.remove('mini-active');
      }
    }
    endLine.classList.add('mini-stop'); // the block closes: repeating stops
    await sleep(700);
    return;
  }

  const badge = document.createElement('span');
  badge.className = 'squish-chip loop-lap';
  badge.textContent = `↻ ${times} times`;
  container.appendChild(badge);
  const chips = words.map((w) => {
    const chip = document.createElement('span');
    chip.className = 'squish-chip';
    chip.textContent = w;
    container.appendChild(chip);
    return chip;
  });
  let endChip = null;
  if (variant === 'end') {
    endChip = document.createElement('span');
    endChip.className = 'squish-chip chip-end-dim';
    endChip.textContent = 'end';
    container.appendChild(endChip);
  }
  await sleep(900); // beat: read the pair before it starts moving
  for (let lap = 1; lap <= times; lap++) {
    badge.textContent = `↻ ${lap}/${times}`;
    badge.classList.remove('pop-badge');
    void badge.offsetWidth; // restart the pop
    badge.classList.add('pop-badge');
    for (let i = 0; i < words.length; i++) {
      chips[i].classList.add('chip-active');
      await runCommand(demo.grid, demo.state, words[i], fx);
      chips[i].classList.remove('chip-active');
    }
    await sleep(250); // beat between laps so they read as separate
  }
  if (endChip) {
    // The stopping point IS the lesson on this card.
    badge.textContent = '✋ stop!';
    badge.classList.remove('pop-badge');
    void badge.offsetWidth;
    badge.classList.add('pop-badge');
    endChip.classList.remove('chip-end-dim');
    endChip.classList.add('squish-result');
    await sleep(600);
  }
}

// Resolves 'done' (Next tapped after typing), 'skip' (one step forward
// without typing) or 'back' (one step backward). canGoBack hides Back on
// the lesson's first step.
export function runLearnPhase(els, command, audio, canGoBack) {
  return new Promise((resolve) => {
    const gen = ++cardGen;
    const stale = () => gen !== cardGen; // a newer card owns the UI now
    els.word.textContent = command.word;
    // Optional glyph anchor next to the word (⬆ on go-up, "⬅ vs ↺" on the
    // contrast card) — styled quiet: the word is the star, the arrow is
    // the meaning anchor. Cleared when the card has none.
    // Guarded: wordHint is a v0.73 element. A deployed build serving an older
    // main.js/index.html (the deploy-subset case — production runs current
    // learn.js against a pre-11 main.js) has no such element, so els.wordHint
    // is undefined. Touching it there threw a TypeError that aborted the whole
    // card render (word + Back/Skip showed, tiles/demo/mascot never built).
    // Lessons 1-10 don't use word_hint, so silently skipping it is correct.
    if (els.wordHint) {
      els.wordHint.textContent = command.word_hint || '';
      els.wordHint.hidden = !command.word_hint;
    }
    // Silent gloss caption under the word — card gloss wins, then the locale
    // dictionary, else hidden (precedence lives in js/gloss.js). Replaces the
    // v0.60 RU toggle: that button is now the 🌍 language control (wired in
    // main.js), and the caption shows itself whenever the active language has
    // one — the language CHOICE is the lookup now, per card it stays silent.
    activeCaption = { glossEl: els.gloss, command };
    refreshLearnGloss();
    els.nextBtn.hidden = true;

    els.backBtn.hidden = !canGoBack;
    els.backBtn.onclick = () => resolve('back');
    els.skipBtn.onclick = () => resolve('skip');

    // Demo strip visible immediately in its "before" state.
    els.demoArea.hidden = false;
    let demo = setupDemo(els.demoGrid, command, els.demoPouch);

    els.sayBtn.onclick = () => audio.playWord(command.audio_key, command.spoken_phrase);

    // Watch-only cards: no typing — the show plays on its own, then Next
    // appears. Replay reruns it all. "watch" = the go(N) squish collapse;
    // "watch-loop" = the repeat(N) lap-counter show.
    if (command.mode === 'watch' || command.mode === 'watch-loop') {
      els.slots.innerHTML = '';
      els.bank.innerHTML = '';
      let showing = false;
      const runShow = async () => {
        if (showing) return;
        showing = true;
        els.nextBtn.hidden = true;
        demo = setupDemo(els.demoGrid, command, els.demoPouch); // fresh before-state
        if (command.mode === 'watch-loop') {
          audio.playWord(command.audio_key, command.spoken_phrase);
          await playLoopShow(els.squish, demo, command, audio);
        } else {
          // Squish-less watch cards (one-move vocabulary demos like
          // go-down, the go-left/turn-left contrast) go straight to the
          // demo — playSquish assumes a squish_count and would crash.
          if (command.squish_count) await playSquish(els.squish, command);
          else els.squish.hidden = true;
          await playDemo(demo, command, audio);
        }
        if (stale()) return; // skipped mid-show: leave the new card alone
        els.nextBtn.hidden = false;
        showing = false;
      };
      els.replayBtn.onclick = runShow;
      els.nextBtn.onclick = () => resolve('done');
      // watch-loop's runShow speaks the word itself — playing it here TOO
      // fired two speaks milliseconds apart, and the second one's cancel()
      // cut the first off mid-word (intermittent "chunky" pronunciation).
      // The squish watch card keeps this play: its demo re-speaks only
      // after the ~2s squish beat — two clean pronunciations, by design.
      // Squish-less watch cards (v0.73) have no such beat — their demo
      // speaks immediately, so playing here too would recreate the same
      // double-speak race.
      if (command.mode !== 'watch-loop' && command.squish_count) {
        audio.playWord(command.audio_key, command.spoken_phrase);
      }
      runShow();
      return;
    }

    // Typing cards with a loop_show (repeat and end) auto-play their show
    // once as an intro before the kid types, and replay it when typing
    // completes. queueShow serializes runs so a fast typist can't start a
    // second show mid-animation.
    let showBusy = Promise.resolve();
    const queueShow = () => {
      showBusy = showBusy.then(async () => {
        if (stale()) return; // a queued show must not rebuild the next card's demo
        demo = setupDemo(els.demoGrid, command, els.demoPouch); // fresh before-state
        await playLoopShow(els.squish, demo, command, audio);
      });
      return showBusy;
    };

    if (!command.loop_show) els.squish.hidden = true;
    const letters = command.spelling;
    let next = 0; // index of the next letter the kid must tap

    els.replayBtn.onclick = async () => {
      if (command.loop_show) { queueShow(); return; }
      demo = setupDemo(els.demoGrid, command, els.demoPouch); // reset to the before state
      await sleep(400); // beat to register the reset, then replay
      playDemo(demo, command, audio);
    };

    // Empty slots the tapped letters fill in.
    els.slots.innerHTML = '';
    const slotEls = letters.map((ch) => {
      const s = document.createElement('span');
      s.className = 'slot' + (ch === '-' ? ' slot-hyphen' : '');
      els.slots.appendChild(s);
      return s;
    });

    // Shuffled bank: this word's tiles plus any distractors (extra digit
    // tiles on go(N) cards — picking the RIGHT number is the exercise;
    // a wrong one wiggles like any wrong letter, no penalty).
    els.bank.innerHTML = '';
    for (const ch of shuffled([...letters, ...(command.extra_tiles || [])])) {
      const b = document.createElement('button');
      b.className = 'letter-btn';
      b.textContent = ch;
      b.onclick = async () => {
        if (b.disabled) return;
        if (ch !== letters[next]) {
          // Wrong letter: wiggle, no penalty.
          b.classList.add('wiggle');
          setTimeout(() => b.classList.remove('wiggle'), 400);
          return;
        }
        b.disabled = true;
        slotEls[next].textContent = ch;
        slotEls[next].classList.add('filled');
        next++;
        const letterSaid = audio.speakLetter(ch);
        if (next === letters.length) {
          // Last letter tapped → action plays, word spoken over it. Wait for
          // the letter to finish first: both are MP3s since v0.87, and MP3s
          // don't cancel each other the way two speak() calls did, so firing
          // straight into the word talked over the "…e" of "remove". No extra
          // delay on top — the clip's own tail is the pause, and anything
          // longer reads as "nothing is happening" and invites a Skip tap.
          await letterSaid;
          if (stale()) return; // skipped during the letter: new card owns Next
          if (command.loop_show) await queueShow();
          else await playDemo(demo, command, audio);
          if (stale()) return; // skipped mid-demo: the new card owns Next
          els.nextBtn.hidden = false;
        }
      };
      els.bank.appendChild(b);
    }

    els.nextBtn.onclick = () => resolve('done');

    audio.playWord(command.audio_key, command.spoken_phrase);
    if (command.loop_show) queueShow(); // the intro show, before any typing
  });
}
