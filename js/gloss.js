// Silent gloss caption for a command card or hint chip. TWO gloss layers
// exist BY DESIGN (decided 2026-08-13, do not consolidate them):
//   1. card-level `<lang>_gloss` on the lesson JSON (today ru_gloss only) —
//      human-authored and context-inflected ("иди 2 шага", "построй мост"),
//      so it WINS over the dictionary where it exists;
//   2. js/locales/*.js dictionary glosses — one bare entry per base command
//      word, the scalable default across all 11 languages.
// Deliberately NOT i18n.gloss(): that helper falls back to English, and an
// English "caption" under an English word is noise — a word the active
// language doesn't cover (e.g. climb/swim in kk/uz/uk) must return null so
// the caption element hides entirely, never an empty or English box.
// Captions are TEXT ONLY: the command word itself stays English and keeps
// its Jenny MP3 — never wire audio to a caption.
export function captionFor(card) {
  const i18n = window.i18n;
  if (!i18n || i18n.lang === 'en') return null; // the big word IS the English
  const specific = card[i18n.lang + '_gloss'];
  if (specific) return specific;
  // Count/composite cards resolve via base ("go(2)" → "go"); cards with
  // neither a card gloss nor a dictionary key (recap/contrast cards like
  // "go-left ≠ turn-left") fall through to null on purpose.
  const key = card.base || card.word;
  const locales = window.AXO_LOCALES || {};
  const table = (locales[i18n.lang] && locales[i18n.lang].gloss) || {};
  return (key in table) ? table[key] : null;
}
