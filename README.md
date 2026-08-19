# axo — Browser Demo

A standalone, browser-based demo of **AXO**, a proof-of-concept digital game that helps young non-native English-speaking children (approximately ages 5–9) build foundational English literacy and foundational computational thinking *at the same time*, through interactive gameplay. This build is a self-contained slice of the full application, prepared as a research artifact accompanying a study introducing the **Integrated Language and Logic Acquisition (ILLA)** framework.

Rather than treating English as a barrier that stands between a non-native child and learning to code, ILLA positions English as a functional tool the child uses to accomplish meaningful algorithmic tasks — so literacy and logic are acquired together rather than in sequence.

**▶️ Live demo:** https://arinaesp.github.io/axo-demo/

> No installation, login, or account required — open the link and play.

---

## About

axo teaches young learners the vocabulary of programming — commands like `go`, `turn-left`, `jump`, and `remove` — by having them guide a character through puzzles. Each lesson pairs a spoken and written English command with an immediate in-game action, so vocabulary is acquired through use rather than memorization.

This demo contains the first two lessons of the full curriculum. It is intended to let readers, reviewers, and parents experience the core learning loop directly.

## What this demo shows

The demo instantiates ILLA's **two-phase architecture**, the core of the framework:

- **Learn Phase — form and literacy.** Each command is introduced as English: letter–sound mapping, orthography, and typing. Audio voices the word and its letters, supporting pronunciation and reading alongside recognition.
- **Challenge Phase — meaning and action.** The learner applies the command to guide the axolotl avatar across a grid, executing simple imperative instructions (e.g. `go`, `turn-left`, `jump`, `remove`). Meaning is confirmed by what the character does — a digital extension of Total Physical Response, where input maps directly to action.

Also demonstrated:

- **Multilingual gloss support** — the 🌍 language picker offers supporting captions in 11 languages (English, Russian, Kyrgyz, Kazakh, Uzbek, Ukrainian, Spanish, French, Chinese, German, Italian). The target vocabulary stays in English; only the first-language gloss changes, reflecting the framework's use of L1 scaffolding for comprehensible input.
- **Audio-first vocabulary** — each command and letter is voiced, supporting the literacy dimension directly.

## Scope and limitations

This is a **demonstration build**, not the production application:

- Only lessons 1–2 are included; the full app has a larger curriculum.
- It runs entirely in the browser with no backend — progress is stored locally in the browser and is not synced or saved beyond the device.
- The production app runs as a Telegram Mini App with additional features; all platform-specific and access-control code has been removed from this public build.

## Running locally

The demo is a static site with no build step. To run it on your own machine:

```bash
git clone https://github.com/arinaesp/axo-demo.git
cd axo-demo
python3 -m http.server 8000
```

Then open `http://localhost:8000` in a browser.

## Technology

Vanilla JavaScript, HTML, and CSS — no frameworks, no build tooling. Audio is served as pre-generated MP3 files. The full production version uses a Cloudflare Worker backend, which is not part of this demo.

## Research context

This demo accompanies:

> Arina Bolotbekova. *Integrated Language and Logic Acquisition (ILLA): Unifying English Literacy and Computational Thinking in Early Digital Game-Based Learning.* Independent Researcher, Bishkek, Kyrgyzstan, 2026.

**ILLA** is a conceptual and design-based pedagogical framework for teaching foundational English literacy and foundational computational thinking simultaneously to young non-native English-speaking children. It is grounded primarily in Task-Based Language Teaching (TBLT), with a digital extension of Total Physical Response ("d-TPR") as the moment-to-moment input–action feedback mechanism, and is further informed by Cognitive Load Theory, dual-coding and multimedia-learning principles, comprehensible input theory, and computational-thinking pedagogy. AXO is the framework's proof-of-concept artifact; this browser build lets readers experience its core learning loop directly.

<!-- Once you mint a Zenodo DOI for this repo, add its badge here, e.g.:
[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.XXXXXXX.svg)](https://doi.org/10.5281/zenodo.XXXXXXX)
-->

## License

This work is licensed under a
[Creative Commons Attribution-NonCommercial 4.0 International License (CC BY-NC 4.0)](https://creativecommons.org/licenses/by-nc/4.0/).

You are free to **share** and **adapt** this material for **non-commercial** purposes, provided you give appropriate **attribution**. Commercial use is not permitted without prior permission. See the [LICENSE](LICENSE) file for the full terms.

[![License: CC BY-NC 4.0](https://img.shields.io/badge/License-CC%20BY--NC%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc/4.0/)

## Author

Built by Arina Bolotbekova — Independent Researcher, Bishkek, Kyrgyzstan ([@arinaesp](https://github.com/arinaesp)).
