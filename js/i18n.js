// js/i18n.js — load AFTER all js/locales/*.js (they populate window.AXO_LOCALES)
(function () {
  const LOCALES = window.AXO_LOCALES || {};

  const LANG_LABELS = {
    en:'EN', ru:'RU', ky:'KG', kk:'KZ', uz:'UZ', uk:'UA',
    es:'ES', fr:'FR', zh:'中', de:'DE', it:'IT'
  };
  const LANG_NAMES = {
    en:'English', ru:'Русский', ky:'Кыргызча', kk:'Қазақша',
    uz:'Oʻzbekcha', uk:'Українська', es:'Español', fr:'Français',
    zh:'中文(简体)', de:'Deutsch', it:'Italiano'
  };
  // Awaiting native confirmation — picker can show a β on these.
  // Remove an entry once a native user confirms it.
  const PROVISIONAL = { kk:true, uz:true, uk:true };

  const FALLBACK = 'en';
  // Only languages whose file actually loaded count as supported.
  const SUPPORTED = Object.keys(LANG_LABELS).filter(c => LOCALES[c]);

  let currentLang = FALLBACK;

  function normalize(code) {
    if (!code) return null;
    const base = String(code).toLowerCase().split('-')[0]; // 'zh-CN' -> 'zh'
    return SUPPORTED.includes(base) ? base : null;
  }

  function detect() {
    try { // 1. explicit stored choice wins
      const saved = localStorage.getItem('axo_lang');
      if (saved && SUPPORTED.includes(saved)) return saved;
    } catch (e) {}
    try { // 2. the browser's own language preference
      const langs = (navigator.languages && navigator.languages.length)
        ? navigator.languages : [navigator.language];
      for (var i = 0; i < langs.length; i++) {
        const n = normalize(langs[i]);
        if (n) return n;
      }
    } catch (e) {}
    return FALLBACK; // 3. fallback
  }

  function setLang(code) {
    if (!SUPPORTED.includes(code)) return;
    currentLang = code;
    try { localStorage.setItem('axo_lang', code); } catch (e) {}
    applyTranslations();
  }

  function t(id) {
    const L = (LOCALES[currentLang] && LOCALES[currentLang].ui) || {};
    const F = (LOCALES[FALLBACK] && LOCALES[FALLBACK].ui) || {};
    return (id in L) ? L[id] : ((id in F) ? F[id] : id);
  }

  function gloss(word) {
    const L = (LOCALES[currentLang] && LOCALES[currentLang].gloss) || {};
    const F = (LOCALES[FALLBACK] && LOCALES[FALLBACK].gloss) || {};
    return (word in L) ? L[word] : ((word in F) ? F[word] : word);
  }

  function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-gloss]').forEach(function (el) {
      el.textContent = gloss(el.getAttribute('data-gloss'));
    });
  }

  function init() {
    currentLang = detect();
    applyTranslations();
  }

  window.i18n = {
    init: init, setLang: setLang, t: t, gloss: gloss,
    applyTranslations: applyTranslations,
    get lang() { return currentLang; },
    LANG_LABELS: LANG_LABELS, LANG_NAMES: LANG_NAMES,
    PROVISIONAL: PROVISIONAL, SUPPORTED: SUPPORTED
  };
})();
