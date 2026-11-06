'use strict';
// UI language: English is the source text; German comes from i18n-de.js. t('English text', {n: 3}) fills {n}.
(() => {
  let lang = 'en';
  const dict = { de: {} };

  const t = (text, vars) => {
    let out = (lang === 'de' && dict.de[text]) || text;
    if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
    return out;
  };

  /** Translate the static markup: data-i18n (text), data-i18n-ph (placeholder), data-i18n-title (title). */
  function translateDom(root = document) {
    for (const n of root.querySelectorAll('[data-i18n]')) {
      if (n.dataset.src == null) n.dataset.src = n.textContent;
      n.textContent = t(n.dataset.src);
    }
    for (const n of root.querySelectorAll('[data-i18n-ph]')) {
      if (n.dataset.srcPh == null) n.dataset.srcPh = n.getAttribute('placeholder');
      n.setAttribute('placeholder', t(n.dataset.srcPh));
    }
    for (const n of root.querySelectorAll('[data-i18n-title]')) {
      if (n.dataset.srcTitle == null) n.dataset.srcTitle = n.getAttribute('title');
      n.setAttribute('title', t(n.dataset.srcTitle));
    }
  }

  window.I18n = {
    t, translateDom,
    register(code, entries) { dict[code] = { ...(dict[code] || {}), ...entries }; },
    set(code) { lang = dict[code] ? code : 'en'; document.documentElement.lang = lang; translateDom(); document.dispatchEvent(new Event('hearth:lang')); },
    get lang() { return lang; },
    get missing() { return null; },
  };
  window.t = t;
})();
