// Audio layer. Four kinds of sound, deliberately kept apart:
//   words   — assets/audio/words/<audio_key>.mp3   (playWord)
//   letters — assets/audio/letters/<letter>.mp3    (speakLetter; also the
//             digit and open_/close_parenthesis clips)
//   phrases — assets/audio/phrases/<audio_key>.mp3 (playPhrase)
//   effects — assets/audio/<audio_key>.mp3         (play)
// The first three are pre-generated (Edge TTS, en-US-JennyNeural) and are the
// VOICE: they obey the 🗣 toggle. Effects are not voice and stay on 🎵.
// Every path falls back the same way: MP3 → speechSynthesis → silence, so a
// lesson whose MP3s haven't been generated yet (11+) still speaks. Drop in
// the missing MP3s later — no code change needed.
// NOT migrated to the async storage module: the mute flag is read in a sync
// constructor (making AudioManager async-init would cascade into main.js
// boot order), and it's a device preference rather than per-user progress.
// Left on raw localStorage for review.
const MUTE_KEY = 'codequest.muted';
const VOICE_MUTE_KEY = 'codequest.voiceMuted'; // TTS voice, separate from music
const MUSIC_VOL = 0.25;
const DUCK_VOL = 0.1; // music level while a pronunciation is speaking

// Phases where the TTS voice may speak. Learn = auditory acquisition (word
// cards speak on appearance, letters speak as they're tapped); Play =
// visual/logical application — command entry and Run execution stay silent
// so the voice never competes with problem-solving. Play-phase call sites
// are GATED on this set, never deleted: to give a phase its voice back,
// add it here ('play') — a one-line change. Celebrations (goal cheer, coin
// milestone) are deliberately outside the gate. Unrelated to the 🎵 mute
// toggle, which mutes only the background music.
export const SPEECH_PHASES = new Set(['learn']);

// Hint-chip tap-to-hear, phase by phase. Split OUT of SPEECH_PHASES because
// the two play-phase voice sites want opposite answers: a chip tap is the kid
// ASKING for the word (scaffolded recall — they choose when they need it),
// while the typed-command echo speaks unbidden over problem-solving time.
// SPEECH_PHASES still governs the echo, so the two move independently.
// Includes 'play': chips are tappable and show 🔊 in Challenge.
export const CHIP_SPEECH_PHASES = new Set(['learn', 'play']);

// Run-phase command narration. OFF: the Challenge phase is silent while the
// program runs, by pedagogy — Learn teaches pronunciation, Challenge TESTS
// recall, and the kid should be reading and saying the words themselves
// rather than hearing the app say them back. v0.88 turned this on (Total
// Physical Response) and it competed with exactly that: the voice does the
// remembering for them.
// Deliberately NOT folded into SPEECH_PHASES: that gate governs command
// ENTRY (typed echo, hint chips). This one governs EXECUTION, so the two can
// be reasoned about separately. The narration machinery below
// (narrateCommand / resetNarration) is kept, not deleted, and the play.js
// call sites stay gated on this flag — flip to true to voice runs again.
// Unaffected either way: the goal/coin celebration phrases and every
// Learn-phase voice.
export const SPEAK_RUN_COMMANDS = false;

// Synthesized stand-in effects, for audio_keys whose MP3 doesn't exist yet.
// Without one, an effect key falls through to the TTS fallback — which the
// play phase starves with an empty phrase (v0.68/v0.75), so "collect" made
// no sound at all. A couple of oscillator notes need no binary asset and no
// download. The moment <key>.mp3 IS recorded, play() finds the file and
// never reaches this map — same "drop in real MP3s later" contract as the
// rest of this file. Values are note frequencies, played in sequence.
// Spelling-tile characters whose NAME has to be spoken, and whose clip can't
// be named after the character itself (no "(.mp3"). Same folder and the same
// MP3 → TTS fallback as the letters, so a missing file still speaks.
const PUNCT_NAMES = {
  '(': { file: 'open_parenthesis', spoken: 'open parenthesis' },
  ')': { file: 'close_parenthesis', spoken: 'close parenthesis' },
};

// Spoken form of a command's count argument, for the TTS fallback when
// letters/<n>.mp3 doesn't exist. Counts above 5 never appear in a level.
const NUMBER_WORDS = {
  2: 'two', 3: 'three', 4: 'four', 5: 'five',
  6: 'six', 7: 'seven', 8: 'eight', 9: 'nine',
};

const SFX_TONES = {
  coin_get: [880, 1318.5], // A5 → E6: a bright two-note pickup
};

export class AudioManager {
  constructor(basePath = './assets/audio/') {
    this.basePath = basePath;
    this.wordsPath = basePath + 'words/';
    this.lettersPath = basePath + 'letters/';
    this.phrasesPath = basePath + 'phrases/';
    this.missing = new Set(); // clip URLs that 404'd — skip straight to TTS
    this.music = null; // looping background track, created on first Play tap
    this.muted = localStorage.getItem(MUTE_KEY) === '1';
    this.voiceMuted = localStorage.getItem(VOICE_MUTE_KEY) === '1';
    this.musicWanted = false; // set once Play is tapped; lets unmute resume
    this.duckDepth = 0; // pronunciations speaking right now (they can overlap)
    this.fadeTimer = null;
    this.voice = null; // best available English TTS voice (picked below)
    this.offlineVoice = null; // best LOCAL voice — fallback when online fails
    this.onlineFlaky = false; // set after one online failure: stay offline
    // Stop-functions for voice clips (word/letter/phrase MP3s) playing right
    // now, so the 🗣 toggle can cut one off mid-word — the same courtesy
    // speak() has always given TTS. Cleared as each clip settles.
    this._voiceClips = new Set();
    // The word/phrase clip currently sounding, if any, so a new one can stop
    // it — mirroring speak()'s interrupt:true default. Applies to Learn word
    // cards (a new card supersedes the old one) and celebration phrases (the
    // payoff outranks whatever is still trailing). Letters and run narration
    // are NOT interrupted — cutting those mid-word is the v0.88 bug.
    this._wordClip = null;
    // Run narration is SERIALIZED, not skip-if-busy: each line's word waits
    // for the previous one to finish instead of being dropped. The chain is
    // the tail of that queue; the generation invalidates anything still
    // queued when a run ends or is abandoned. See narrateCommand.
    this._narrateChain = Promise.resolve();
    this._narrateGen = 0;
    // Live utterances, anchored until they settle: Chrome garbage-collects
    // an unreferenced SpeechSynthesisUtterance MID-SPEECH — the voice stops
    // dead partway through the word and onend never fires. Holding a strong
    // reference here is the standard workaround.
    this._live = new Set();
    // Supersession generation: bumped by every interrupting speak() (and by
    // a mid-flight voice mute). An utterance whose generation is stale was
    // deliberately replaced, not dropped by a flaky engine — it must never
    // retry and never stall-cancel. See speak() for the bug this fixes.
    this._gen = 0;
    this._initVoice();
  }

  // Pick the most natural-sounding English voice this browser offers,
  // instead of the robotic default. "Natural"/"Neural" (Edge), "Enhanced"/
  // "Premium" (iOS/macOS) and Google voices all beat the plain fallback.
  // The full list is logged to the console so a specific voice can be
  // hand-picked and pinned later. Voices load async in some browsers, so
  // we also listen for voiceschanged.
  _initVoice() {
    if (!('speechSynthesis' in window)) return;
    const pick = () => {
      const voices = speechSynthesis.getVoices();
      if (!voices.length) return;
      console.log('CodeQuest — available TTS voices:');
      for (const v of voices) {
        console.log(`  ${v.name} — ${v.lang}${v.default ? ' (browser default)' : ''}${v.localService ? '' : ' [online]'}`);
      }
      const score = (v) => {
        const n = v.name.toLowerCase();
        let s = 0;
        if (n.includes('natural')) s += 100;
        if (n.includes('neural')) s += 90;
        if (n.includes('enhanced') || n.includes('premium')) s += 80;
        if (n.includes('google')) s += 40;
        if (v.lang.toLowerCase().startsWith('en-us')) s += 10;
        else if (v.lang.toLowerCase().startsWith('en-gb')) s += 6;
        return s;
      };
      const en = voices.filter((v) => (v.lang || '').toLowerCase().startsWith('en'));
      this.voice = en.sort((a, b) => score(b) - score(a))[0] || null;
      // Best voice that works WITHOUT internet (e.g. Microsoft Zira) — the
      // fallback when an online voice can't speak on a dropped connection.
      this.offlineVoice =
        en.filter((v) => v.localService).sort((a, b) => score(b) - score(a))[0] || null;
      if (this.voice) {
        console.log(`CodeQuest — picked TTS voice: ${this.voice.name} (${this.voice.lang})`);
      }
      if (this.offlineVoice) {
        console.log(`CodeQuest — offline fallback voice: ${this.offlineVoice.name} (${this.offlineVoice.lang})`);
      }
    };
    pick();
    speechSynthesis.addEventListener?.('voiceschanged', pick);
  }

  // Ducking: drop the music under a pronunciation, fade it back up after.
  // Counted, not boolean — quick letter taps can overlap, and the music must
  // stay low until the *last* one finishes.
  _duck() {
    this.duckDepth++;
    if (!this.music) return;
    clearInterval(this.fadeTimer); // a fade-back in progress loses
    this.music.volume = DUCK_VOL;
  }

  _unduck() {
    this.duckDepth = Math.max(0, this.duckDepth - 1);
    if (this.duckDepth > 0 || !this.music) return;
    clearInterval(this.fadeTimer);
    this.fadeTimer = setInterval(() => {
      if (!this.music || this.duckDepth > 0) return clearInterval(this.fadeTimer);
      this.music.volume = Math.min(MUSIC_VOL, this.music.volume + 0.015);
      if (this.music.volume >= MUSIC_VOL) clearInterval(this.fadeTimer);
    }, 50); // ~0.5s ramp from ducked back to full
  }

  // Background music. Must be called from a user gesture (autoplay is blocked
  // otherwise). Idempotent: repeat calls (e.g. Play again) resume the same
  // element rather than restarting the track. Screens are shown/hidden within
  // one page, so the element keeps playing across all of them. Mutes only the
  // music — the voice has its own toggle (setVoiceMuted / 🗣 button).
  startMusic(src = './bg-music.mp3') {
    this.musicWanted = true;
    this.musicSrc = src;
    if (this.muted) return;
    if (this.music) {
      if (this.music.paused) this.music.play().catch(() => {});
      return;
    }
    this.music = new Audio(src);
    this.music.loop = true;
    this.music.volume = MUSIC_VOL;
    this.music.play().catch(() => { this.music = null; }); // retry on next tap
  }

  setMuted(muted) {
    this.muted = muted;
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    if (muted) {
      if (this.music) this.music.pause();
    } else if (this.musicWanted) {
      // The unmute tap is itself a user gesture, so play() is allowed here.
      this.startMusic(this.musicSrc);
    }
  }

  // Voice mute: silences word cards, tapped letters, celebrations and the
  // effect fallbacks, while music keeps its own 🎵 toggle. Two enforcement
  // points now that the voice is mostly MP3: speak() for anything synthesized,
  // and playWord/speakLetter for the recorded clips (which never reach
  // speak()). The v0.69 note that clips "would NOT be silenced by this" is
  // resolved — that was written when no clips existed. Effect clips still go
  // through play() and are deliberately NOT silenced: 🗣 is voice-only.
  setVoiceMuted(muted) {
    this.voiceMuted = muted;
    localStorage.setItem(VOICE_MUTE_KEY, muted ? '1' : '0');
    // Muting mid-word should cut the voice off, not let it finish.
    if (muted) {
      // Recorded clips: stop() pauses and settles the pending promise, so the
      // caller isn't left awaiting and the music un-ducks immediately rather
      // than waiting out the watchdog.
      for (const stop of [...this._voiceClips]) stop();
      // TTS: the generation bump marks everything in flight as superseded — a
      // cancelled-while-pending utterance must not come back via the
      // dropped-utterance retry after the kid asked for silence.
      if ('speechSynthesis' in window) {
        this._gen++;
        speechSynthesis.cancel();
      }
    }
  }

  // Must be called from a user gesture (the Play button) so iOS/Android
  // browsers allow later speechSynthesis + Audio playback.
  unlock() {
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
    }
  }

  // Effect sounds (splash, crunch, coin_get…): assets/audio/<key>.mp3, no
  // clips recorded yet, so in practice these still land on _fallback's chime
  // or spoken stand-in. NOT gated on voiceMuted — effects are not the voice.
  // opts rides through to speak() on the TTS-fallback path — Learn demos use
  // { interrupt: false } so effect sounds queue behind the word being spoken
  // instead of cancelling it mid-way.
  play(audioKey, fallbackText, opts) {
    return this._clip(this.basePath + audioKey + '.mp3', null, () =>
      this._fallback(audioKey, fallbackText, opts));
  }

  // Word pronunciation: the pre-generated clip if one exists (lessons 1–10
  // today), else speechSynthesis so an ungenerated lesson still speaks. Used
  // by Learn cards and, since v0.88, by each line of a run. This is the
  // voice, so 🗣 silences it.
  playWord(audioKey, fallbackText, opts) {
    if (this.voiceMuted) return Promise.resolve();
    return this._clip(this.wordsPath + audioKey + '.mp3', 'voice-interrupt', () =>
      this.speak(fallbackText, opts));
  }

  // Run-phase command narration — same clips as playWord, different policy:
  // QUEUED, never interrupting. A command clip runs ~1s while its animation
  // takes ~450ms, so interrupting clipped multi-syllable words mid-word
  // ("turn-" for turn-right). The earlier fix for that was skip-if-busy, but
  // it silenced every line after the first: the kid heard one word per run.
  // Now each word waits its turn — the narration trails the animation by up
  // to a beat, which is the right trade (every command IS heard, and TPR
  // survives a short lag far better than it survives silence).
  // Fire-and-forget at the call site — never awaited, so the animation is
  // still not paced by audio.
  // count > 1 speaks the argument after the word ("go" + "three" for go(3)) —
  // the number is part of the command the kid typed, so it is part of what
  // the animal says. Digits reuse the letters/ clips (2.mp3 says "two").
  narrateCommand(audioKey, fallbackText, count = 1) {
    if (this.voiceMuted) return Promise.resolve();
    const gen = this._narrateGen;
    // Anything queued behind an abandoned run must not still be speaking over
    // whatever screen replaced it — every step re-checks the generation and
    // the mute flag before it sounds.
    const live = () => !this.voiceMuted && gen === this._narrateGen;
    this._narrateChain = this._narrateChain
      .then(() => {
        if (!live()) return;
        return this._clip(this.wordsPath + audioKey + '.mp3', 'voice', () =>
          this.speak(fallbackText));
      })
      .then(() => {
        if (!live() || !(count > 1)) return;
        const spoken = NUMBER_WORDS[count] || String(count);
        return this._clip(this.lettersPath + count + '.mp3', 'voice', () =>
          this.speak(spoken));
      })
      // A broken link in the chain must not wedge every later line.
      .catch((err) => { console.log('CodeQuest — narration step failed:', err); });
    return this._narrateChain;
  }

  // Drop narration still queued (run finished, or the kid jumped away mid-run).
  // Whatever is sounding right now is left to finish — it is a word the kid is
  // watching happen, and cutting it is the mid-word clipping this queue exists
  // to avoid.
  resetNarration() {
    this._narrateGen++;
    this._narrateChain = Promise.resolve();
  }

  // Celebration/feedback lines ("Great job!"). Same contract as
  // playWord, different folder — these are sentences, not vocabulary, and
  // keeping them apart means a phrase file can never shadow a command word.
  playPhrase(audioKey, fallbackText, opts) {
    if (this.voiceMuted) return Promise.resolve();
    return this._clip(this.phrasesPath + audioKey + '.mp3', 'voice-interrupt', () =>
      this.speak(fallbackText, opts));
  }

  // Plays one MP3, resolving when it finishes — or running `fallback` and
  // resolving after that when the file isn't there.
  // voiceMode: null = effect (not voice, ignores 🗣, never interrupts);
  // 'voice' = voice, left to finish, interrupts nothing (letters, run
  // narration); 'voice-interrupt' = voice, and cuts off the word/phrase
  // before it the way a new speak() cancels the last.
  _clip(url, voiceMode, fallback) {
    if (voiceMode === 'voice-interrupt') this._wordClip?.(); // cut off the previous
    if (this.missing.has(url)) return fallback();
    this._duck();
    return new Promise((resolve) => {
      const audio = new Audio(url);
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        this._voiceClips.delete(stop);
        // Identity-guarded: a later clip may already own the slot, and
        // clearing it here would leave that one un-interruptible.
        if (this._wordClip === stop) this._wordClip = null;
        this._unduck();
        resolve();
      };
      const stop = () => {
        try { audio.pause(); } catch (err) { /* best-effort, as everywhere here */ }
        done();
      };
      if (voiceMode) this._voiceClips.add(stop);
      if (voiceMode === 'voice-interrupt') this._wordClip = stop;
      // A missing file both REJECTS play() and fires onerror, so the two
      // paths below can each fire for the same call. `done` was already
      // guarded; the fallback itself was not — harmless while it was always
      // speak() (a second speak just cancels and re-says the same word), but
      // an audible double-hit now that a key can fall back to a chime.
      let fellBack = false;
      const fallBack = () => {
        if (fellBack) return;
        fellBack = true;
        this.missing.add(url); // per-URL: words/ and letters/ miss independently
        Promise.resolve(fallback()).then(done, done);
      };
      audio.onended = done;
      audio.onerror = fallBack;
      audio.play().catch(fallBack);
      // Watchdog, same idea as _speakOnce's: some webviews never fire
      // onended, and that must not hang an awaited play() or leave the
      // music stuck at the ducked volume. 4s — short enough to un-stall
      // quickly, generous enough for slow devices.
      setTimeout(done, 4000);
    });
  }

  // No MP3 for this key: a synthesized effect if one is defined for it,
  // otherwise the spoken fallback as before. Always resolves.
  _fallback(audioKey, fallbackText, opts) {
    const tones = SFX_TONES[audioKey];
    if (tones) return this._chime(tones);
    return this.speak(fallbackText, opts);
  }

  // Short WebAudio chime. Rides the 🎵 toggle: this is non-voice sound and
  // 🗣 is documented as voice-only, so the music toggle is the only existing
  // control that can silence it — a sound effect a kid can't mute is worse
  // than one filed under the wrong toggle. Best-effort like everything else
  // here: any failure is swallowed, gameplay never depends on audio.
  _chime(freqs) {
    try {
      if (this.muted) return Promise.resolve();
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return Promise.resolve();
      // Lazily created and reused — a fresh AudioContext per pickup would
      // leak (browsers cap how many a page may open).
      this._actx = this._actx || new Ctx();
      const ctx = this._actx;
      ctx.resume?.(); // suspended after a backgrounded tab; no-op otherwise
      freqs.forEach((f, i) => {
        const t = ctx.currentTime + i * 0.09;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle'; // softer than a square, brighter than a sine
        osc.frequency.value = f;
        // Exponential ramps: a hard gain change clicks audibly.
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.25);
      });
    } catch (err) {
      console.log('CodeQuest — chime failed (skipping):', err);
    }
    return Promise.resolve();
  }

  // One utterance attempt. Resolves true if it (at least) started speaking,
  // false if it errored or never started within startTimeoutMs — which is
  // what an online-only voice does on a dead connection. cancelOnStall
  // controls the stall path: an interrupting utterance clears the engine so
  // a retry starts clean, but a QUEUED one (effect sound waiting behind a
  // word) must never cancel — that would nuke the whole queue, word included.
  _speakOnce(text, rate, lang, voice, startTimeoutMs, cancelOnStall = true, stale = () => false) {
    return new Promise((resolve) => {
      let started = false;
      let settled = false;
      const u = new SpeechSynthesisUtterance(text);
      this._live.add(u); // GC anchor — see constructor comment
      const finish = (ok) => {
        if (!settled) { settled = true; this._live.delete(u); resolve(ok); }
      };
      u.lang = lang;
      u.rate = rate;
      if (voice) u.voice = voice;
      u.onstart = () => { started = true; };
      u.onend = () => finish(true);
      // An error after speech began still counts as spoken — don't repeat
      // the word a second time in another voice.
      u.onerror = () => finish(started);
      speechSynthesis.speak(u);
      setTimeout(() => {
        if (!started) {
          // A superseded utterance must NOT stall-cancel: this timeout can
          // fire seconds after a newer speak() took over the engine, and a
          // cancel() here would chop that CURRENT speech mid-word.
          if (cancelOnStall && !stale()) speechSynthesis.cancel();
          finish(false);
        }
      }, startTimeoutMs);
      // Hard cap: some webviews START speaking but never fire onend. 4s
      // force-advances anyway (3s was too tight on slow devices; 6s felt
      // laggy). It sits ABOVE every startTimeoutMs used below (<=2500), so a
      // never-started utterance is still caught first by the start timeout as
      // ok=false — the signal the retry keys off.
      setTimeout(() => finish(true), 4000);
    });
  }

  // Speaks with the natural (possibly online) voice; a failed first attempt
  // is retried once — with the offline fallback when one exists (connection
  // dropped, service down), else the same voice (Chrome intermittently drops
  // an utterance queued right after cancel(); the second attempt lands).
  // One online failure flips the whole session to the offline voice, so
  // later words don't each pay the detection wait.
  // interrupt: true (default) cuts off whatever is speaking — right for a
  // new word or a letter tap. false QUEUES behind the current utterance —
  // used for effect sounds that land while a word is being pronounced, so
  // the word is never chopped mid-way.
  async speak(text, { rate = 0.8, lang = 'en-US', interrupt = true } = {}) {
    if (this.voiceMuted) return; // before ducking — nothing will sound
    this._duck();
    try {
      if (!text) return; // silenced effect fallback — normal, not a failure
      if (!('speechSynthesis' in window)) return; // no engine; word stays on screen
      // Supersession marker: every interrupting speak() makes all earlier
      // in-flight utterances obsolete. A superseded utterance often reports
      // "never started" — cancel() on a still-PENDING utterance fires no
      // event on some Chrome builds, so its _speakOnce only settles via its
      // own start timeout seconds later — and the dropped-utterance retry
      // below then re-spoke it: the "last letter echoes after the word"
      // bug (letter → word → effect → letter again). stale() lets the
      // retry and the stall-cancel tell "the engine flaked" (retry) from
      // "deliberately replaced by newer speech" (stay dead).
      const myGen = interrupt ? ++this._gen : this._gen;
      const stale = () => this._gen !== myGen;
      if (interrupt && (speechSynthesis.speaking || speechSynthesis.pending)) {
        // cancel() followed by an immediate speak() intermittently swallows
        // the new utterance on Chrome/Android while the engine tears down —
        // the "word never spoken" bug. Cancel only when something is
        // actually live, then give the engine a beat to settle.
        speechSynthesis.cancel();
        await new Promise((r) => setTimeout(r, 60));
        // Superseded during the settle beat: queueing now would speak this
        // utterance AFTER its replacement, out of order. Let it go.
        if (stale()) return;
      }
      // A paused engine swallows speak() silently (Chrome quirk after tab
      // backgrounding / long utterances) — resume() is a no-op otherwise.
      speechSynthesis.resume();
      const primary = this.onlineFlaky && this.offlineVoice
        ? this.offlineVoice
        : this.voice;
      if (!interrupt) {
        // Queued utterance: generous start window (it legitimately waits for
        // the current word to finish first), no stall-cancel, no retry —
        // a lost effect sound is not worth risking the word ahead of it.
        await this._speakOnce(text, rate, lang, primary, 6000, false, stale);
        return;
      }
      // Online voices that will fail do so by never starting — give them
      // 1.5s, then move on. Local voices start fast; 2.5s is generous while
      // keeping the dropped-utterance retry quick enough to still land the
      // teaching moment.
      const startTimeout = primary && !primary.localService ? 1500 : 2500;
      const ok = await this._speakOnce(text, rate, lang, primary, startTimeout, true, stale);
      // Retry only a GENUINELY dropped utterance: not one a newer speak()
      // superseded, and not one the kid muted mid-flight.
      if (!ok && !stale() && !this.voiceMuted) {
        let retryVoice = primary;
        if (this.offlineVoice && primary !== this.offlineVoice) {
          this.onlineFlaky = true;
          retryVoice = this.offlineVoice;
          console.log(`CodeQuest — online voice unavailable, using ${this.offlineVoice.name}`);
        }
        // 2500 (was 4000) keeps the retry's start window below the 3s hard cap.
        // No session-wide "engine is broken" latch any more (v0.87): TTS is now
        // the fallback, not the primary, so a dead engine costs at most the two
        // start timeouts on the handful of keys with no MP3 — not on every card.
        await this._speakOnce(text, rate, lang, retryVoice, 2500, true, stale);
      }
    } catch (err) {
      // Some webviews throw from speechSynthesis.speak/cancel/resume. Audio is
      // best-effort — never let that bubble into a caller and abort a render
      // or reject a fire-and-forget play(). Skip this word; the next tries
      // again (no permanent latch — a throw may be transient).
      console.log('CodeQuest — speech attempt threw (skipping):', err);
    } finally {
      this._unduck();
    }
  }

  // Letter names during spelling, from assets/audio/letters/<char>.mp3 —
  // a–z plus the digits that appear in spelling tiles (2.mp3 says "two",
  // 3.mp3 "three") and the two parentheses (open_parenthesis.mp3 /
  // close_parenthesis.mp3 — a filename because "(" can't be one). A tapped
  // tile that made no sound read as a broken tile; the brackets are part of
  // the command's spelling, so they are named like every other character.
  // The hyphen stays silent on purpose: "turn-left" is taught as ONE word,
  // and "turn hyphen left" would make it sound like three.
  // Anything else, or a character with no clip, falls back to speech.
  speakLetter(letter) {
    if (letter === '-') return Promise.resolve();
    if (this.voiceMuted) return Promise.resolve();
    const named = PUNCT_NAMES[letter];
    if (named) {
      return this._clip(this.lettersPath + named.file + '.mp3', 'voice', () =>
        this.speak(named.spoken, { rate: 0.9 }));
    }
    const say = () => this.speak(letter, { rate: 0.9 });
    const ch = String(letter).toLowerCase();
    if (!/^[a-z0-9]$/.test(ch)) return say(); // no filename could exist for it
    return this._clip(this.lettersPath + ch + '.mp3', 'voice', say);
  }
}
